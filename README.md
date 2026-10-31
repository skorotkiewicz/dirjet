# dirjet

[![npm version](https://img.shields.io/npm/v/dirjet)](https://www.npmjs.com/package/dirjet)
[![CI](https://github.com/skorotkiewicz/dirjet/actions/workflows/ci.yml/badge.svg)](https://github.com/skorotkiewicz/dirjet/actions/workflows/ci.yml)
[![Built with Rust](https://img.shields.io/badge/built_with-Rust-b7410e)](https://github.com/skorotkiewicz/dirjet/blob/main/Cargo.toml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/skorotkiewicz/dirjet/blob/main/LICENSE)

A Rust static file server for directories and individual files.

Run it with `npx` or `bunx`. No configuration file or Rust toolchain required.

[Documentation](https://github.com/skorotkiewicz/dirjet/tree/main/docs) · [Contributing](https://github.com/skorotkiewicz/dirjet/blob/main/CONTRIBUTING.md)

## Why use dirjet?

- Runs a native binary, downloaded and cached for your OS and CPU.
- Serves `index.html` files, directory listings, or a single file with its relative assets.
- Supports file streaming, MIME types, HEAD requests, byte ranges, and conditional caching.
- Blocks dotfiles, parent directory traversal, and symlinks that resolve outside the document root.

---

## Quick start

Requires Node.js 18+ or Bun.

```bash
# Serve a specific directory
npx dirjet ./my-website

# Serve a single HTML file
npx dirjet index.html

# Serve the current directory
npx dirjet
```

The server listens at `http://127.0.0.1:3000` by default. Stop it with Ctrl+C.

With Bun, use `bunx dirjet ./my-website`. If Node.js is not installed, use `bunx --bun dirjet ./my-website` to run the launcher with Bun.

---

## How it serves files

### Directories

Directories serve `index.html` when present, otherwise they show a directory listing. Directory URLs redirect to a trailing slash so relative assets resolve correctly.

### Single files

Passing a file, such as `npx dirjet presentation.html`, serves it at `/` and `/presentation.html`. Its parent directory becomes the document root so relative stylesheets, scripts, and images work, including assets in subdirectories.

Other non-hidden files in that parent directory are also accessible by URL. Directory listings are disabled in single-file mode.

`dirjet` serves static files. Build TypeScript, JSX, and other frontend source assets before serving them. It does not transpile code, provide live reload, or terminate TLS.

---

## Options

```bash
dirjet [OPTIONS] [PATH]
```

| Option | Default | What it does |
| :--- | :--- | :--- |
| `-p`, `--port <PORT>` | `3000` | Change the server port. Use `0` to automatically pick an available port. |
| `-l`, `--listen <PORT>` | `3000` | Alias for `--port`. |
| `--host <IP>` | `127.0.0.1` | Bind to a specific IP address. Use `0.0.0.0` to make the server accessible to other devices on your local network. |
| `-s`, `--single` | Off | Single-page app mode. Serve the entry file for missing extensionless routes. |
| `--no-listing` | Off | Returns a `404 Not Found` for directories that don't have an `index.html` file, instead of showing a directory list. |
| `-h`, `--help` | | Show the help menu. |
| `-V`, `--version` | | Show the current version. |

### Serve a single-page app

```bash
npx dirjet -s ./dist -p 8080
```

Missing routes such as `/users/42` return `index.html` so your frontend router can handle them. Missing assets such as `/missing.js` still return 404. When serving a single file, `--single` uses that file as the fallback.

---

## Binary downloads and caching

On first run, the JavaScript launcher downloads the native binary for your OS and CPU from the matching GitHub release. It verifies the binary's SHA-256 checksum before running it and saves it in your OS cache directory. The first run needs access to GitHub Releases.

Later runs verify and reuse the cached binary. Each version has a separate cache entry. Interrupted or invalid downloads are discarded. No postinstall scripts run.

Prebuilt binaries support Linux, macOS, and Windows on x64 and ARM64.

Set `DIRJET_CACHE_DIR` to use a custom, writable cache directory.
