#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { constants } = require("node:os");

const supported = new Set([
  "darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64",
  "win32-arm64", "win32-x64",
]);
const platform = `${process.platform}-${process.arch}`;
const binaryName = process.platform === "win32" ? "serve-rs.exe" : "serve-rs";

function binaryPath() {
  if (!supported.has(platform)) {
    throw new Error(`Unsupported platform: ${platform}. Build from source with cargo build --release.`);
  }
  try {
    return require.resolve(`serve-rs-${platform}/bin/${binaryName}`);
  } catch {
    // Only source checkouts have Cargo.toml. Published packages require the native dependency.
    const root = join(__dirname, "..");
    if (existsSync(join(root, "Cargo.toml"))) {
      for (const profile of ["release", "debug"]) {
        const candidate = join(root, "target", profile, binaryName);
        if (existsSync(candidate)) return candidate;
      }
    }
    throw new Error(
      `Missing serve-rs-${platform}. Reinstall serve-rs with optional dependencies enabled. ` +
      "For a source checkout, run cargo build --release first.",
    );
  }
}

try {
  const child = spawn(binaryPath(), process.argv.slice(2), { stdio: "inherit" });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  function cleanup() {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
  child.on("error", (error) => {
    cleanup();
    console.error(`serve-rs: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    cleanup();
    process.exitCode = code ?? (128 + (constants.signals[signal] ?? 1));
  });
} catch (error) {
  console.error(`serve-rs: ${error.message}`);
  process.exitCode = 1;
}
