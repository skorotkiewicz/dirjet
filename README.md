# serve-rs

A Rust static file server for directories and individual files, distributed through npm.

After the first release is published:

```sh
bunx serve-rs dir/
bunx serve-rs example.html
bunx serve-rs
```

The server listens at `http://127.0.0.1:3000` by default. The last command serves the current directory. Stop it with Ctrl+C.

The npm launcher runs on Node.js 18+ or Bun. If Node.js is not installed, use `bunx --bun serve-rs dir/` to run the launcher with Bun. No Rust toolchain is required for npm users. `npx serve-rs dir/` works too.

## Serving files

Directories use `index.html` when present, otherwise they show a directory listing. Directory URLs redirect to a trailing slash so relative assets resolve correctly.

When you pass a file, `/` and its filename URL both serve that file. Its parent directory becomes the document root so relative CSS, JavaScript, and images work, including assets in subdirectories. Other non-hidden files in that parent directory are accessible by URL. Directory listings are disabled in this mode.

The server streams files and supports MIME types, HEAD, byte ranges, and Last-Modified conditional requests. Responses use `Cache-Control: no-cache` so browsers revalidate local edits. Dotfiles, parent traversal, and symlinks resolving outside the document root are rejected.

This is a static server. Build TypeScript, JSX, and other source assets before serving them. It does not transpile code or provide live reload, TLS, or full compatibility with `serve` configuration files.

## Options

```sh
serve-rs [OPTIONS] [PATH]
```

| Option | Default | Behavior |
| --- | --- | --- |
| `-p, --port PORT` | `3000` | TCP port. Use `0` to choose an available port. |
| `-l, --listen PORT` | `3000` | Alias for `--port`. |
| `--host IP` | `127.0.0.1` | Bind address. Use `0.0.0.0` to allow network access. |
| `-s, --single` | Off | Serve the entry file for missing extensionless routes. |
| `--no-listing` | Off | Return 404 for directories without `index.html`. |
| `-h, --help` | | Show help. |
| `-V, --version` | | Show version. |

For a single-page application:

```sh
bunx serve-rs -s dist/ -l 8080
```

Missing routes such as `/users/42` return `index.html`. Missing assets such as `/missing.js` still return 404. With a file argument, `--single` uses that file as the fallback. A missing entry file causes startup to fail.

## Develop

Install stable Rust and Bun. No JavaScript dependencies need to be installed.

```sh
cargo run -- dir/
cargo run -- example.html
bun run test
bun run check
bun run build
```

`bun run test` runs the Rust HTTP tests and launcher integration tests. The latter build a native executable and exercise it through the staged npm package. `bun run check` runs rustfmt and Clippy. The release binary is `target/release/serve-rs`, or `serve-rs.exe` on Windows.

## npm packaging and releases

The main `serve-rs` package contains a small JavaScript launcher. Six optional packages contain binaries for Linux, macOS, and Windows on x64 and ARM64. Linux release binaries use musl to support both glibc and musl systems. There are no postinstall scripts or runtime binary downloads.

To stage a package for your current machine:

```sh
bun run package
bun pm pack --cwd dist/npm/serve-rs --dry-run
```

This creates `dist/npm/serve-rs/` and `dist/npm/serve-rs-<platform>/`. For cross-compiled artifacts, pass the platform and binary explicitly:

```sh
bun scripts/package.mjs --platform linux-x64 --binary target/x86_64-unknown-linux-musl/release/serve-rs
```

Do not publish a partial release. The **Release packages** GitHub Actions workflow builds and tests all six platforms, checks package versions, and uploads a combined `npm-packages` artifact. It only builds artifacts; it does not publish to npm.

To publish:

1. Confirm you can publish `serve-rs` and all six `serve-rs-<platform>` package names on npm. If a name is unavailable, update the manifests, launcher, and packaging scripts consistently.
2. Keep the version in `Cargo.toml`, `Cargo.lock`, `package.json`, and all optional dependency versions in sync.
3. Run **Release packages** against the release commit. Download and extract its `npm-packages` artifact into `dist/`. It contains `npm/` staging directories and `tarballs/` ready to publish.
4. Run `bun scripts/verify-release.mjs dist/npm` and inspect the staged contents with `bun pm pack --cwd dist/npm/serve-rs --dry-run`.
5. Authenticate with npm, then publish each native tarball using `npm publish ./dist/tarballs/serve-rs-<platform>-<version>.tgz --access public`. Publish the main tarball last with `npm publish ./dist/tarballs/serve-rs-<version>.tgz --access public`. The tarballs preserve executable permissions through the artifact download.
6. Verify the release with `bunx serve-rs --version` and `bunx serve-rs example.html`.

Publish the staged packages, which omit development scripts. The root package has a prepublish check that requires all six staged native packages.

See the [npm package manifest documentation](https://docs.npmjs.com/cli/configuring-npm/package-json/) for platform selection and optional dependencies.
