use std::{fs, path::Path};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    response::Response,
};
use clap::Parser;
use tempfile::{TempDir, tempdir};
use tower::ServiceExt;

use crate::{cli::Cli, server::Server};

fn fixture() -> TempDir {
    let directory = tempdir().expect("temporary fixture directory should be available");
    fs::write(directory.path().join("index.html"), "<h1>home</h1>").expect("write fixture");
    fs::write(directory.path().join("example.html"), "<h1>example</h1>").expect("write fixture");
    fs::write(directory.path().join("style.css"), "body { color: red }").expect("write fixture");
    fs::write(directory.path().join(".env"), "SECRET=hidden").expect("write fixture");
    fs::create_dir(directory.path().join("assets")).expect("write fixture");
    fs::write(directory.path().join("assets/a & b.txt"), "spaces").expect("write fixture");
    directory
}

async fn router(path: &Path, flags: &[&str]) -> Router {
    let mut cli = Cli::try_parse_from(std::iter::once("dirjet").chain(flags.iter().copied()))
        .expect("fixture arguments should be valid");
    cli.path = path.to_owned();
    Server::new(&cli)
        .await
        .expect("fixture root should be valid")
        .router()
}

async fn request(app: Router, method: &str, uri: &str, headers: &[(&str, &str)]) -> Response {
    let mut builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    app.oneshot(
        builder
            .body(Body::empty())
            .expect("test request should be valid"),
    )
    .await
    .expect("router should be infallible")
}

async fn text(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("body should fit test limit");
    String::from_utf8(bytes.to_vec()).expect("fixture body should be UTF-8")
}

#[tokio::test]
async fn directory_index_and_file_content_types() {
    let directory = fixture();
    let response = request(router(directory.path(), &[]).await, "GET", "/", &[]).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "text/html");
    assert_eq!(response.headers()["cache-control"], "no-cache");
    assert_eq!(text(response).await, "<h1>home</h1>");
    let response = request(
        router(directory.path(), &[]).await,
        "GET",
        "/style.css",
        &[],
    )
    .await;
    assert_eq!(response.headers()["content-type"], "text/css");
    assert_eq!(text(response).await, "body { color: red }");
}

#[tokio::test]
async fn single_file_maps_root_and_serves_relative_assets() {
    let directory = fixture();
    let file = directory.path().join("example.html");
    for url in ["/", "/example.html"] {
        let response = request(router(&file, &[]).await, "GET", url, &[]).await;
        assert_eq!(text(response).await, "<h1>example</h1>");
    }
    let response = request(router(&file, &[]).await, "GET", "/style.css", &[]).await;
    assert_eq!(response.status(), StatusCode::OK);
    let response = request(
        router(&file, &[]).await,
        "GET",
        "/assets/a%20%26%20b.txt",
        &[],
    )
    .await;
    assert_eq!(text(response).await, "spaces");
    let response = request(router(&file, &[]).await, "GET", "/assets/", &[]).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn listings_encode_urls_and_escape_html() {
    let directory = fixture();
    if cfg!(unix) {
        fs::write(directory.path().join("assets/<script>.txt"), "escaped").expect("write fixture");
    }
    let response = request(router(directory.path(), &[]).await, "GET", "/assets/", &[]).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = text(response).await;
    assert!(
        body.contains("./a%20%26%20b%2Etxt"),
        "filename must be URL encoded: {body}"
    );
    assert!(
        body.contains("a &amp; b.txt"),
        "label must be HTML escaped: {body}"
    );
    if cfg!(unix) {
        assert!(
            body.contains("&lt;script&gt;.txt"),
            "HTML filenames must be escaped: {body}"
        );
    }
    assert!(
        !body.contains("<script>"),
        "listing must not inject filename markup"
    );
    let response = request(
        router(directory.path(), &["--no-listing"]).await,
        "GET",
        "/assets/",
        &[],
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn directory_redirect_preserves_query_and_stays_on_origin() {
    let directory = fixture();
    let response = request(
        router(directory.path(), &[]).await,
        "GET",
        "/assets?q=x",
        &[],
    )
    .await;
    assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(response.headers()["location"], "/assets/?q=x");
    let response = request(router(directory.path(), &[]).await, "GET", "//assets", &[]).await;
    assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(response.headers()["location"], "/assets/");
}

#[tokio::test]
async fn spa_fallback_keeps_missing_assets_as_404() {
    let directory = fixture();
    for path in [
        directory.path().to_owned(),
        directory.path().join("example.html"),
    ] {
        let response = request(router(&path, &["--single"]).await, "GET", "/users/42", &[]).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            text(response).await.contains("<h1>"),
            "fallback should contain entry HTML"
        );
        for uri in ["/missing.js", "/.env", "/.git/config", "/%2e%2e/secret"] {
            let response = request(router(&path, &["--single"]).await, "GET", uri, &[]).await;
            assert_eq!(
                response.status(),
                StatusCode::NOT_FOUND,
                "{uri} must not use SPA fallback"
            );
        }
    }
    let response = request(router(directory.path(), &[]).await, "GET", "/users/42", &[]).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn blocks_traversal_hidden_files_and_windows_path_forms() {
    let directory = fixture();
    for uri in [
        "/.env",
        "/%2eenv",
        "/../secret",
        "/%2e%2e/secret",
        "/assets/%2e%2e/index.html",
        "/%5c..%5csecret",
        "/C:%5csecret",
        "/style.css:stream",
        "/%00",
    ] {
        let response = request(router(directory.path(), &[]).await, "GET", uri, &[]).await;
        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "must reject {uri}"
        );
    }
    let response = request(router(directory.path(), &[]).await, "GET", "/%FF", &[]).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn head_returns_headers_without_file_or_listing_bodies() {
    let directory = fixture();
    for uri in ["/", "/assets/"] {
        let get = request(router(directory.path(), &[]).await, "GET", uri, &[]).await;
        let expected_length = text(get).await.len();
        let head = request(router(directory.path(), &[]).await, "HEAD", uri, &[]).await;
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(
            head.headers()["content-length"],
            expected_length.to_string()
        );
        assert!(text(head).await.is_empty(), "HEAD must have an empty body");
    }
}

#[tokio::test]
async fn range_and_conditional_requests() {
    let directory = fixture();
    let response = request(
        router(directory.path(), &[]).await,
        "GET",
        "/style.css",
        &[("range", "bytes=0-3")],
    )
    .await;
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["content-range"], "bytes 0-3/19");
    let modified = response.headers()["last-modified"]
        .to_str()
        .expect("HTTP date")
        .to_owned();
    assert_eq!(text(response).await, "body");
    let response = request(
        router(directory.path(), &[]).await,
        "GET",
        "/style.css",
        &[("if-modified-since", &modified)],
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(response.headers()["content-length"], "19");
    assert!(text(response).await.is_empty(), "304 must have no body");
    let response = request(
        router(directory.path(), &[]).await,
        "HEAD",
        "/style.css",
        &[("if-modified-since", &modified)],
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert!(
        text(response).await.is_empty(),
        "conditional HEAD must have no body"
    );
    let response = request(
        router(directory.path(), &[]).await,
        "GET",
        "/style.css",
        &[("range", "bytes=1000-")],
    )
    .await;
    assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn methods_other_than_get_and_head_are_rejected() {
    let directory = fixture();
    let response = request(router(directory.path(), &[]).await, "POST", "/", &[]).await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(response.headers()["allow"], "GET, HEAD");
}

#[tokio::test]
async fn invalid_roots_and_missing_spa_entries_fail_at_startup() {
    let directory = tempdir().expect("temporary directory");
    let mut cli = Cli::try_parse_from(["dirjet", "--single"]).expect("valid arguments");
    cli.path = directory.path().to_owned();
    assert!(Server::new(&cli).await.is_err(), "SPA needs an entry file");
    cli.single = false;
    cli.path = directory.path().join("missing");
    assert!(
        Server::new(&cli).await.is_err(),
        "missing root must fail before listening"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn symlinks_cannot_expose_outside_or_hidden_files() {
    use std::os::unix::fs::symlink;
    let directory = fixture();
    let outside = tempdir().expect("outside directory");
    fs::write(outside.path().join("secret"), "outside").expect("write outside fixture");
    symlink(outside.path(), directory.path().join("external")).expect("create symlink");
    symlink(
        directory.path().join(".env"),
        directory.path().join("hidden-alias"),
    )
    .expect("create symlink");
    symlink(
        directory.path().join("style.css"),
        directory.path().join("safe-alias"),
    )
    .expect("create symlink");
    for uri in ["/external/secret", "/hidden-alias"] {
        let response = request(
            router(directory.path(), &["--single"]).await,
            "GET",
            uri,
            &[],
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "alias must be blocked: {uri}"
        );
    }
    let response = request(
        router(directory.path(), &[]).await,
        "GET",
        "/safe-alias",
        &[],
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    fs::remove_file(directory.path().join("index.html")).expect("remove index for listing");
    let body = text(request(router(directory.path(), &[]).await, "GET", "/", &[]).await).await;
    assert!(
        !body.contains("external"),
        "outside symlinks must not appear in listings"
    );
    assert!(
        !body.contains("hidden-alias"),
        "hidden targets must not appear in listings"
    );
    assert!(
        !body.contains(".env"),
        "hidden files must not appear in listings"
    );
}

#[test]
fn cli_accepts_serve_style_listen_and_validates_ports() {
    let cli = Cli::try_parse_from(["dirjet", "example.html", "-l", "8080", "-s"])
        .expect("valid arguments");
    assert_eq!(cli.port, 8080);
    assert!(cli.single, "-s enables fallback");
    assert!(
        Cli::try_parse_from(["dirjet", "--port", "65536"]).is_err(),
        "port must fit u16"
    );
}
