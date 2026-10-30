use std::{
    fmt::Write,
    io,
    path::{Component, Path},
};

use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use tokio::fs;

/// Builds a directory listing using escaped labels and encoded URL segments.
pub(crate) async fn render(root: &Path, directory: &Path, url_path: &str) -> io::Result<String> {
    let mut entries = fs::read_dir(directory).await?;
    let mut items = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let Ok(canonical) = fs::canonicalize(entry.path()).await else {
            continue;
        };
        if !canonical.starts_with(root) {
            continue;
        }
        if canonical.strip_prefix(root).map_err(io::Error::other)?.components().any(|part| {
            matches!(part, Component::Normal(name) if name.to_string_lossy().starts_with('.'))
        }) {
            continue;
        }
        let metadata = fs::metadata(&canonical).await?;
        if metadata.is_dir() || metadata.is_file() {
            items.push((name.to_owned(), metadata.is_dir()));
        }
    }
    items.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));

    let title = escape(url_path);
    let mut html = format!(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>Index of {title}</title>\
         <style>body{{font:16px system-ui;max-width:60rem;margin:4rem auto;padding:0 1rem}}\
         li{{margin:.75rem 0}}a{{color:#2563eb}}h1{{overflow-wrap:anywhere}}</style>\
         <h1>Index of {title}</h1><ul>"
    );
    if url_path != "/" {
        html.push_str("<li><a href=\"../\">../</a></li>");
    }
    for (name, is_directory) in items {
        let suffix = if is_directory { "/" } else { "" };
        // Writing to a String cannot return a formatting error.
        write!(
            html,
            "<li><a href=\"./{}{suffix}\">{}{suffix}</a></li>",
            utf8_percent_encode(&name, NON_ALPHANUMERIC),
            escape(&name),
        )
        .expect("writing to a String is infallible");
    }
    html.push_str("</ul></html>");
    Ok(html)
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
