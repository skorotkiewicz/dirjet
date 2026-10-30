use std::{
    io,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result, bail};
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{Html, IntoResponse, Response},
};
use percent_encoding::percent_decode_str;
use tokio::fs;
use tower_http::services::ServeFile;

use crate::{cli::Cli, listing};

/// Canonical document root and routing settings shared by concurrent requests.
pub(crate) struct Server {
    root: PathBuf,
    entry: Option<PathBuf>,
    single: bool,
    listing: bool,
}

impl Server {
    /// Validates the supplied path before starting the listener.
    pub(crate) async fn new(cli: &Cli) -> Result<Self> {
        let path = fs::canonicalize(&cli.path)
            .await
            .with_context(|| format!("could not open {}", cli.path.display()))?;
        let metadata = fs::metadata(&path).await?;
        let (root, entry) = if metadata.is_dir() {
            (path, None)
        } else if metadata.is_file() {
            let root = path
                .parent()
                .context("file has no parent directory")?
                .to_owned();
            (root, Some(path))
        } else {
            bail!("{} is not a regular file or directory", cli.path.display());
        };
        if entry
            .as_ref()
            .and_then(|p| p.file_name())
            .is_some_and(|name| name.to_string_lossy().starts_with('.'))
        {
            bail!("hidden files cannot be served");
        }
        let server = Self {
            root,
            entry,
            single: cli.single,
            listing: !cli.no_listing,
        };
        if server.single {
            let entry = server.entry_path();
            let resolved = server.resolve(&entry).await.context(
                "--single requires an entry file or index.html inside the document root",
            )?;
            if !fs::metadata(resolved).await?.is_file() {
                bail!("--single requires a regular entry file");
            }
        }
        Ok(server)
    }

    /// Consumes the server settings to build an HTTP router.
    pub(crate) fn router(self) -> Router {
        // Axum requests run concurrently and need shared ownership of these settings.
        Router::new().fallback(handle).with_state(Arc::new(self))
    }

    fn entry_path(&self) -> PathBuf {
        self.entry
            .as_ref()
            .map_or_else(|| self.root.join("index.html"), PathBuf::to_owned)
    }

    async fn resolve(&self, path: &Path) -> io::Result<PathBuf> {
        let canonical = fs::canonicalize(path).await?;
        if !canonical.starts_with(&self.root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "path outside document root",
            ));
        }
        // Also reject aliases into hidden directories or hidden files.
        if canonical.strip_prefix(&self.root).map_err(io::Error::other)?.components().any(|part| {
            matches!(part, Component::Normal(name) if name.to_string_lossy().starts_with('.'))
        }) {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "hidden path"));
        }
        Ok(canonical)
    }

    async fn respond(&self, request: Request) -> Response {
        if request.method() != Method::GET && request.method() != Method::HEAD {
            let mut response = StatusCode::METHOD_NOT_ALLOWED.into_response();
            response
                .headers_mut()
                .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
            return response;
        }

        let path = match request_path(request.uri().path()) {
            Ok(path) => path,
            Err(status) => return status.into_response(),
        };
        let candidate = if path.as_os_str().is_empty() {
            self.entry.as_deref().unwrap_or(&self.root).to_owned()
        } else {
            self.root.join(&path)
        };
        let resolved = match self.resolve(&candidate).await {
            Ok(path) => path,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if self.single && path.extension().is_none() {
                    return self.file(&self.entry_path(), request).await;
                }
                return StatusCode::NOT_FOUND.into_response();
            }
            Err(error) => return error_response(error),
        };
        let metadata = match fs::metadata(&resolved).await {
            Ok(metadata) => metadata,
            Err(error) => return error_response(error),
        };
        if metadata.is_file() {
            return self.file(&resolved, request).await;
        }
        if !metadata.is_dir() {
            return StatusCode::NOT_FOUND.into_response();
        }
        // Single-file mode exposes sibling assets but never lists its parent directory.
        if self.entry.is_some() {
            return StatusCode::NOT_FOUND.into_response();
        }
        if !request.uri().path().ends_with('/') {
            let mut location = format!("{}/", request.uri().path());
            if let Some(query) = request.uri().query() {
                location.push('?');
                location.push_str(query);
            }
            // Keep Location relative to the origin, including for paths starting with //.
            location = format!("/{}", location.trim_start_matches('/'));
            return match HeaderValue::from_str(&location) {
                Ok(location) => (
                    StatusCode::PERMANENT_REDIRECT,
                    [(header::LOCATION, location)],
                )
                    .into_response(),
                Err(_) => StatusCode::BAD_REQUEST.into_response(),
            };
        }
        match self.resolve(&resolved.join("index.html")).await {
            Ok(index) => return self.file(&index, request).await,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return error_response(error),
        }
        if !self.listing {
            return StatusCode::NOT_FOUND.into_response();
        }
        match listing::render(&self.root, &resolved, request.uri().path()).await {
            Ok(html) => Html(html).into_response(),
            Err(error) => error_response(error),
        }
    }

    async fn file(&self, path: &Path, request: Request) -> Response {
        // Recheck the entry for SPA requests too, in case it was replaced after startup.
        let path = match self.resolve(path).await {
            Ok(path) => path,
            Err(error) => return error_response(error),
        };
        match ServeFile::new(&path).try_call(request).await {
            Ok(mut response) => {
                if response.status() == StatusCode::NOT_MODIFIED {
                    // Axum otherwise infers zero from the empty 304 body. Any length
                    // on a 304 must describe the selected file representation.
                    match fs::metadata(&path).await {
                        Ok(metadata) => {
                            response
                                .headers_mut()
                                .insert(header::CONTENT_LENGTH, HeaderValue::from(metadata.len()));
                        }
                        Err(error) => return error_response(error),
                    }
                }
                response.map(Body::new)
            }
            Err(error) => error_response(error),
        }
    }
}

async fn handle(State(server): State<Arc<Server>>, request: Request) -> Response {
    let mut response = server.respond(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn request_path(url: &str) -> Result<PathBuf, StatusCode> {
    let decoded = percent_decode_str(url)
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut path = PathBuf::new();
    for part in decoded.split('/') {
        if part.is_empty() {
            continue;
        }
        if part.starts_with('.') || part.contains(['\\', '\0', ':']) {
            return Err(StatusCode::NOT_FOUND);
        }
        // Each URL segment must remain exactly one normal filesystem component.
        if !matches!(
            Path::new(part).components().next(),
            Some(Component::Normal(_))
        ) {
            return Err(StatusCode::NOT_FOUND);
        }
        path.push(part);
    }
    Ok(path)
}

fn error_response(error: io::Error) -> Response {
    match error.kind() {
        io::ErrorKind::NotFound
        | io::ErrorKind::PermissionDenied
        | io::ErrorKind::NotADirectory => StatusCode::NOT_FOUND,
        _ => {
            eprintln!("filesystem error: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
    .into_response()
}
