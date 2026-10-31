# 🚀 dirjet

**A lightning-fast, zero-config static file server for directories and individual files.**

`dirjet` gives you a production-grade local server instantly. No complex setups, no heavy dependencies, and no compilation required. Just point it at your files and go.

## ✨ Why use dirjet?

*   **Zero Setup:** Run it immediately via `npx` or `bunx`. No Rust or Cargo installation required.
*   **Blazing Fast:** Under the hood, it runs a highly optimized native binary that is automatically downloaded and cached for your specific OS.
*   **Smart Routing:** Automatically serves `index.html`, handles directory listings, and ensures relative assets (CSS, JS, images) resolve correctly.
*   **Modern Web Standards:** Supports file streaming, correct MIME types, byte ranges (great for video/audio), and conditional caching.
*   **Secure by Default:** Automatically blocks hidden dotfiles, parent directory traversal (`../`), and external symlinks.

---

## 🏃 Quick Start

Requires **Node.js (18+)** or **Bun**.

```bash
# Serve a specific directory
npx dirjet ./my-website

# Serve a single HTML file
npx dirjet index.html

# Serve the current directory
npx dirjet
```

By default, the server starts at **`http://127.0.0.1:3000`**. Simply press `Ctrl+C` in your terminal to stop it.

*(Prefer Bun? `bunx dirjet ./my-website` works perfectly too!)*

---

## 📂 How it Serves Files

### Directories
When serving a folder, `dirjet` looks for an `index.html` file. If it finds one, it serves it. If not, it displays a clean, easy-to-navigate directory listing. It also automatically handles trailing slashes in URLs so your relative CSS and JavaScript files load without breaking.

### Single Files
If you pass a specific file (e.g., `npx dirjet presentation.html`), it serves that file at the root (`/`) and at its exact filename. Smartly, it sets the *parent* folder as the document root. This means your relative stylesheets, scripts, and images will work perfectly, even if they are in subdirectories! *(Note: Directory listings are disabled when serving a single file).*

> **Note:** `dirjet` is a pure static server. It does not transpile TypeScript/JSX or provide live-reload. Build your frontend assets before serving them!

---

## ⚙️ Configuration Options

```bash
dirjet [OPTIONS] [PATH]
```

| Option | Default | What it does |
| :--- | :--- | :--- |
| `-p`, `--port <PORT>` | `3000` | Change the server port. Use `0` to automatically pick an available port. |
| `--host <IP>` | `127.0.0.1` | Bind to a specific IP address. Use `0.0.0.0` to make the server accessible to other devices on your local network. |
| `-s`, `--single` | Off | **Single-Page App (SPA) mode.** Routes all missing extensionless paths back to your entry file (e.g., `index.html`). |
| `--no-listing` | Off | Returns a `404 Not Found` for directories that don't have an `index.html` file, instead of showing a directory list. |
| `-h`, `--help` | | Show the help menu. |
| `-V`, `--version` | | Show the current version. |

### 🧩 Example: Serving a Single-Page App (React, Vue, Svelte, etc.)

```bash
npx dirjet -s ./dist -p 8080
```
In this mode, if a user visits `/users/42`, `dirjet` will serve your `index.html` so your frontend router can take over. (Missing actual assets, like `/missing.js`, will still correctly return a `404`).

---

## 🪄 Under the Hood: How the Magic Works

You might wonder how it's so fast without requiring you to install Rust. 

When you run `npx dirjet` for the very first time, a tiny, secure launcher detects your Operating System and CPU architecture. It then downloads the exact native binary you need from the official GitHub release, verifies its integrity, and caches it on your machine. 

The next time you run `dirjet`, it uses that cached binary and starts up instantly. Upgrading to a new version simply caches the new binary.

**Environment Variables:**
*   `DIRJET_CACHE_DIR`: Set this to choose a custom, writable folder for storing the downloaded binaries instead of the default OS cache directory.
