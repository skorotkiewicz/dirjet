# Contributing to dirjet

For installation, usage, and CLI options, see [README.md](README.md).

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

`bun run test` runs the Rust HTTP tests and launcher integration tests. The latter build a native executable and exercise it through the staged npm package. `bun run check` runs rustfmt and Clippy. The release binary is `target/release/dirjet`, or `dirjet.exe` on Windows.

## npm distribution and binary downloads

Only `dirjet` is published to npm. It contains a small JavaScript launcher and the SHA-256 checksums of the native executables.

On the first run, the launcher selects your OS and CPU, downloads the matching executable from the versioned GitHub release, verifies it, and stores it in your operating system's cache directory. Subsequent runs check and reuse that cached binary. Upgrading dirjet selects a separate cache entry for the new version. Interrupted or invalid downloads are discarded.

The first launch needs access to GitHub Releases. No postinstall scripts run, and users do not need Rust or Cargo. Linux release binaries use musl to support both glibc and musl systems.

Set `DIRJET_CACHE_DIR` to choose a different writable cache directory. The launcher creates version and platform subdirectories inside it. The Rust CLI's host and port options are unchanged.

### Local packaging

To build a native binary and stage a local npm test package:

```sh
bun run package
bun pm pack --cwd dist/npm/dirjet --dry-run
```

This creates `dist/native/`, `dist/metadata/`, and `dist/npm/dirjet/` for your current platform. Use `cargo run -- docs/` for local server development. A complete release requires all six platform builds from GitHub Actions.

The workflow stages each cross-compiled executable with:

```sh
bun scripts/package.mjs --platform linux-x64 --binary target/x86_64-unknown-linux-musl/release/dirjet
```

After every platform is staged, `bun scripts/package.mjs` assembles the single npm launcher and its pinned checksum manifest. `bun run prepublishOnly` verifies the complete bundle in `dist/`. Publish the staged tarball through the workflow; publishing the source checkout directly is rejected because it has no generated binary manifest.

### Set up npm authentication

For the first publish, create a granular npm token with **Read and write (publish and stage)** permission and **Bypass two-factor authentication (2FA)** enabled. Store it as the repository's Actions secret named `NPM_TOKEN`. It only needs permission to publish `dirjet`. A read/write token without the bypass setting can fail with `EOTP`. See [npm publishing authentication requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).

After the package exists, configure an npm trusted publisher for this repository and the workflow filename `release.yml`, with direct `npm publish` allowed. The workflow grants `id-token: write` and supports OIDC, so `NPM_TOKEN` can then be removed. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for configuration.

### Release from GitHub Actions

1. Run `just bump <version>` to update `Cargo.toml`, `Cargo.lock`, `package.json`, and the documentation version badge together. For example, `just bump 0.1.3` or `just bump 0.2.0-beta.1`. This only edits those files; commit and push the release changes afterward.
2. Open [Release packages](https://github.com/skorotkiewicz/dirjet/actions/workflows/release.yml), select the release branch or tag, and choose **Run workflow** with publishing enabled.
3. The workflow tests and builds Linux, macOS, and Windows on x64 and ARM64. It verifies every executable and embeds their checksums in the npm package.
4. The workflow checks that an existing npm version matches the staged archive before changing GitHub assets. It then publishes the GitHub release and its binaries, followed by the single `dirjet` npm package. This order makes the download URLs available before users install the launcher.
5. Verify with `bunx dirjet --version` and `bunx dirjet docs/`.

Pushing a matching version tag also starts the release:

```sh
git tag v0.1.1
git push origin v0.1.1
```

A manual run creates `v<version>` at its selected commit if the tag does not exist. Existing tags must point to that commit. Prerelease versions such as `0.2.0-beta.1` use npm's `next` tag and become GitHub prereleases; stable versions use `latest`.

GitHub releases include raw executables named `dirjet-<platform>`, with `.exe` on Windows, native `.tar.gz` archives, and the one npm tarball. The `.tar.gz` archives contain the executable in `bin/` and the license. Every successful build also keeps an `npm-packages` artifact with `npm/`, `native/`, `metadata/`, and `tarballs/` directories.

For a build without publication, uncheck the publish option in a manual workflow run. If npm publishing fails after the GitHub release succeeds, rerun the failed jobs to reuse the original artifacts. A matching published npm archive is skipped; different bytes for an existing npm version stop the release before GitHub assets are replaced.
