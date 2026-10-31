import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const { getBinary } = createRequire(import.meta.url)("../bin/binary.cjs");
const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dirjet-download-"));
  temporary.push(directory);
  const contents = Buffer.from("verified binary fixture");
  const version = "1.2.3";
  const platform = "linux-x64";
  const entry = { file: "dirjet-linux-x64", size: contents.length, sha256: createHash("sha256").update(contents).digest("hex") };
  const manifest = { version, baseUrl: "https://example.invalid/releases/v1.2.3", binaries: { [platform]: entry } };
  return { directory, contents, entry, options: { manifest, version, platform, cacheDirectory: directory } };
}

test("first run downloads the selected binary and the second run works without network", async () => {
  const { options, contents } = await fixture();
  const requested = [];
  const path = await getBinary({ ...options, fetchImpl: async (url) => {
    requested.push(url);
    return new Response(contents);
  } });
  expect(requested).toEqual(["https://example.invalid/releases/v1.2.3/dirjet-linux-x64"]);
  expect(Buffer.from(await readFile(path)).equals(contents)).toBe(true);
  const cached = await getBinary({ ...options, fetchImpl: () => { throw new Error("offline"); } });
  expect(cached).toBe(path);
  if (process.platform !== "win32") expect((await lstat(path)).mode & 0o111).toBe(0o111);
});

test("a checksum mismatch never installs a binary and cleans its partial download", async () => {
  const { options, directory, contents } = await fixture();
  const corrupt = Buffer.from(contents);
  corrupt[0] ^= 1;
  await expect(getBinary({ ...options, fetchImpl: async () => new Response(corrupt) })).rejects.toThrow("checksum verification failed");
  expect(await readdir(join(directory, options.version, options.platform))).toEqual([]);
});

test("a truncated download is rejected", async () => {
  const { options, contents } = await fixture();
  await expect(getBinary({ ...options, fetchImpl: async () => new Response(contents.subarray(0, 4)) })).rejects.toThrow("checksum verification failed");
});

test("an oversized response is stopped before it can be installed", async () => {
  const { options, contents } = await fixture();
  await expect(getBinary({ ...options, fetchImpl: async () => new Response(Buffer.concat([contents, contents])) })).rejects.toThrow("exceeds its expected size");
});

test("a corrupt cache entry is replaced by a verified download", async () => {
  const { options, contents } = await fixture();
  const path = await getBinary({ ...options, fetchImpl: async () => new Response(contents) });
  await writeFile(path, "corrupted");
  let downloads = 0;
  await getBinary({ ...options, fetchImpl: async () => { downloads++; return new Response(contents); } });
  expect(downloads).toBe(1);
  expect(Buffer.from(await readFile(path)).equals(contents)).toBe(true);
});

test("an unavailable release gives a clear error and can be retried", async () => {
  const { options, contents } = await fixture();
  await expect(getBinary({ ...options, fetchImpl: async () => new Response(null, { status: 404 }) })).rejects.toThrow("GitHub release v1.2.3");
  expect(await getBinary({ ...options, fetchImpl: async () => new Response(contents) })).toContain("1.2.3");
});

test("simultaneous first runs leave one valid cache file", async () => {
  const { options, contents, directory } = await fixture();
  const paths = await Promise.all(Array.from({ length: 4 }, () =>
    getBinary({ ...options, fetchImpl: async () => new Response(contents) })));
  expect(new Set(paths).size).toBe(1);
  expect(await readdir(join(directory, options.version, options.platform))).toEqual(["dirjet-linux-x64"]);
  expect(Buffer.from(await readFile(paths[0])).equals(contents)).toBe(true);
});

test("different versions use different cache entries", async () => {
  const { options, contents } = await fixture();
  const first = await getBinary({ ...options, fetchImpl: async () => new Response(contents) });
  const second = await getBinary({
    ...options, version: "1.2.4", manifest: { ...options.manifest, version: "1.2.4" },
    fetchImpl: async () => new Response(contents),
  });
  expect(second).not.toBe(first);
});

test("unsupported platforms and malformed manifests fail before a network request", async () => {
  const { options } = await fixture();
  const fetchImpl = () => { throw new Error("network must not be used"); };
  await expect(getBinary({ ...options, platform: "freebsd-x64", fetchImpl })).rejects.toThrow("Unsupported platform");
  await expect(getBinary({ ...options, version: "9.9.9", fetchImpl })).rejects.toThrow("does not match");
  options.manifest.binaries["linux-x64"].file = "../outside";
  await expect(getBinary({ ...options, fetchImpl })).rejects.toThrow("Invalid binary manifest");
});

test("interrupted downloads clean temporary files and do not poison the cache", async () => {
  const { options, directory } = await fixture();
  await expect(getBinary({ ...options, timeoutMs: 20, fetchImpl: async (_, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true }))
  })).rejects.toThrow("request aborted");
  expect(await readdir(join(directory, options.version, options.platform))).toEqual([]);
});
