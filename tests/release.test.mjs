import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platforms } from "../scripts/platforms.mjs";
import { packageRelease, stageBinary } from "../scripts/release-files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const temporary = [];
const current = process.platform + "-" + process.arch;

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(names, local = false) {
  const directory = await mkdtemp(join(tmpdir(), "djet-release-"));
  temporary.push(directory);
  const binary = join(directory, "fixture.bin");
  await writeFile(binary, "native binary fixture");
  for (const name of names) await stageBinary(directory, name, binary);
  await packageRelease(directory, { local });
  return directory;
}

async function verify(directory, env = {}) {
  const child = Bun.spawn([process.execPath, "scripts/verify-release.mjs", directory], {
    cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env },
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("local test package explains missing release binaries", async () => {
  const result = await verify(await fixture([current], true));
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Incomplete release");
  for (const name of Object.keys(platforms).filter((name) => name !== current)) {
    expect(result.stderr).toContain("metadata/" + name + ".json");
  }
  expect(result.stderr).toContain("Release packages");
  expect(result.stderr).toContain("bun run package");
  expect(result.stderr).not.toContain("ENOENT");
});

test("complete release contains one npm package with all six pinned checksums", async () => {
  const directory = await fixture(Object.keys(platforms));
  const result = await verify(directory);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("all 6 verified native binaries");
  expect(await readdir(join(directory, "npm"))).toEqual(["djet"]);
  const manifest = JSON.parse(await readFile(join(directory, "npm/djet/bin/binaries.json"), "utf8"));
  expect(manifest.baseUrl).toBe("https://github.com/skorotkiewicz/djet/releases/download/v" + source.version);
  expect(Object.keys(manifest.binaries).sort()).toEqual(Object.keys(platforms).sort());
});

test("binary metadata from a different version is rejected", async () => {
  const directory = await fixture(Object.keys(platforms));
  const path = join(directory, "metadata/linux-x64.json");
  const metadata = JSON.parse(await readFile(path, "utf8"));
  metadata.version = "0.0.0";
  await writeFile(path, JSON.stringify(metadata));
  const result = await verify(directory);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Invalid binary metadata or checksum: linux-x64");
});

test("modified native bytes fail verification", async () => {
  const directory = await fixture(Object.keys(platforms));
  await writeFile(join(directory, "native/djet-linux-x64"), "tampered binary");
  const result = await verify(directory);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Invalid binary metadata or checksum");
});

test("npm checksums must match the binaries that will be uploaded to GitHub", async () => {
  const directory = await fixture(Object.keys(platforms));
  const path = join(directory, "npm/djet/bin/binaries.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.binaries["linux-x64"].sha256 = "0".repeat(64);
  await writeFile(path, JSON.stringify(manifest));
  const result = await verify(directory);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("npm binary manifest does not match");
});

test("publishing the source directory is rejected because its binary manifest is generated in staging", async () => {
  const result = await verify("unused", { npm_command: "publish" });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Publish the staged npm tarball");
});
