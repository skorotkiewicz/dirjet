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

The documentation website is in `docs/`. Preview it with `bun run docs`, then open the address printed in the terminal. It uses plain HTML, CSS, and JavaScript and requires no frontend build step.

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

This creates `dist/npm/serve-rs/` and `dist/npm/serve-rs-<platform>/` for local testing. It builds only the current platform. Use GitHub Actions for a complete release; no local packaging or publishing is required.

For cross-compiled artifacts, pass the platform and binary explicitly:

```sh
bun scripts/package.mjs --platform linux-x64 --binary target/x86_64-unknown-linux-musl/release/serve-rs
```

### Set up npm authentication

For the first publish, add a granular npm publish token as the repository's Actions secret named `NPM_TOKEN`. The token must allow publishing `serve-rs` and the six `serve-rs-<platform>` packages. If the npm account requires 2FA, use a token configured for CI publishing. Confirm that all seven package names are available to your account.

After the packages exist, you can configure an npm trusted publisher on each package for this repository and the workflow filename `release.yml`, with direct `npm publish` allowed. The workflow supports OIDC and grants `id-token: write`, so `NPM_TOKEN` can then be removed. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup and authentication requirements.

### Release from GitHub Actions

1. Keep the version in `Cargo.toml`, `Cargo.lock`, `package.json`, and all optional dependency versions in sync. Commit and push the release changes.
2. Open [Release packages](https://github.com/skorotkiewicz/serve-rs/actions/workflows/release.yml), select the release commit's branch or tag, and choose **Run workflow**. Leave **Publish to npm and create a GitHub release** checked.
3. The workflow tests and builds all six platforms, verifies the complete bundle, publishes the native npm packages before the main package, and creates a GitHub release with the native archives and npm tarballs attached. A manual run creates `v<version>` at its selected commit if that tag does not exist.
4. Verify with `bunx serve-rs --version` and `bunx serve-rs example.html`.

Pushing a matching version tag also starts the complete release automatically:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The tag must match the package version. Existing tags must point to the selected commit. Versions with a prerelease suffix, such as `0.2.0-beta.1`, publish under npm's `next` tag and become GitHub prereleases. Stable versions publish under `latest`.

To build without publishing, run the workflow manually and uncheck the publish option. Every successful build keeps a combined `npm-packages` artifact with `npm/`, `native/`, and `tarballs/` directories. GitHub releases provide `serve-rs-<platform>.tar.gz` archives containing the executable in `bin/` and the license.

If publishing fails partway through, rerun the failed jobs to reuse the original archives. Already published packages are skipped only when their registry integrity matches the archive. Different contents for the same version stop the release; bump the version if you need to rebuild a published package.

`bun run prepublishOnly` remains available for verifying a downloaded complete bundle in `dist/npm/`. It intentionally rejects a bundle produced only by a local `bun run package`. The workflow performs this check before publishing.
