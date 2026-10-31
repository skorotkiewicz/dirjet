"use strict";

const { createHash } = require("node:crypto");
const { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm } = require("node:fs/promises");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

function defaultCacheDirectory() {
  if (process.env.DIRJET_CACHE_DIR) return resolve(process.env.DIRJET_CACHE_DIR);
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "dirjet", "Cache");
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "dirjet");
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "dirjet");
}

async function matches(path, entry) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size !== entry.size) return false;
    return createHash("sha256").update(await readFile(path)).digest("hex") === entry.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Downloads only the selected platform and executes no unverified bytes. */
async function getBinary({
  manifest, version, platform = process.platform + "-" + process.arch,
  cacheDirectory = defaultCacheDirectory(), fetchImpl = fetch,
  timeoutMs = 30_000, log = () => {},
}) {
  if (manifest.version !== version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Binary manifest does not match the dirjet package version.");
  }
  if (!Object.hasOwn(manifest.binaries, platform)) {
    throw new Error("Unsupported platform: " + platform + ". Build from source with cargo build --release.");
  }
  const entry = manifest.binaries[platform];
  const expectedFile = "dirjet-" + platform + (platform.startsWith("win32-") ? ".exe" : "");
  if (entry.file !== expectedFile || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 64 * 1024 * 1024) {
    throw new Error("Invalid binary manifest for " + platform + ".");
  }
  const url = new URL(manifest.baseUrl + "/" + entry.file);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Binary downloads require HTTPS.");
  }
  const directory = join(cacheDirectory, version, platform);
  const destination = join(directory, entry.file);
  if (await matches(destination, entry)) {
    await chmod(destination, 0o755);
    return destination;
  }

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(directory, ".download-"));
  const file = join(temporary, entry.file);
  try {
    log("Downloading dirjet " + version + " for " + platform + "...");
    const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) {
      throw new Error("Binary download returned HTTP " + response.status + ". Check that GitHub release v" + version + " is available.");
    }
    if (response.url && new URL(response.url).protocol !== "https:" && !local) {
      throw new Error("Binary download redirected away from HTTPS.");
    }
    const output = await open(file, "wx", 0o600);
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > entry.size) throw new Error("Downloaded binary exceeds its expected size.");
        hash.update(chunk);
        await output.writeFile(chunk);
      }
    } finally {
      await output.close();
    }
    if (size !== entry.size || hash.digest("hex") !== entry.sha256) {
      throw new Error("Binary checksum verification failed. The download was discarded.");
    }
    await chmod(file, 0o755);
    try {
      await rename(file, destination);
    } catch (error) {
      // Another first-run process may have installed the same binary on Windows.
      if (await matches(destination, entry)) return destination;
      if (!["EEXIST", "EPERM", "EACCES"].includes(error.code)) throw error;
      await rm(destination, { force: true });
      try {
        await rename(file, destination);
      } catch (retryError) {
        if (!(await matches(destination, entry))) throw retryError;
      }
    }
    return destination;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { defaultCacheDirectory, getBinary };
