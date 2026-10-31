import { afterEach, expect, test } from "bun:test";
import { TOML } from "bun";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion } from "../scripts/bump-version.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["package.json", "Cargo.toml", "Cargo.lock", "docs/index.html", "README.md", "CONTRIBUTING.md"];
const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function snapshot(directory) {
  return Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dirjet-version-"));
  temporary.push(directory);
  await mkdir(join(directory, "docs"));
  const contents = await snapshot(root);
  await Promise.all(files.map((file, index) => writeFile(join(directory, file), contents[index])));
  return directory;
}

test.each(["0.1.3", "0.2.0-beta.1"])("bump to %s updates release files and preserves dependencies and guides", async (version) => {
  const directory = await fixture();
  const before = await snapshot(directory);
  const previous = JSON.parse(before[0]);
  expect(await bumpVersion(directory, version)).toBe(previous.version);

  const after = await snapshot(directory);
  expect(JSON.parse(after[0])).toEqual({ ...previous, version });
  expect(TOML.parse(after[1]).package.version).toBe(version);
  const lock = TOML.parse(before[2]);
  lock.package.find((entry) => entry.name === previous.name).version = version;
  expect(TOML.parse(after[2])).toEqual(lock);
  expect(after[1]).toBe(before[1].replace('version = "' + previous.version + '"', 'version = "' + version + '"'));
  expect(after[3]).toBe(before[3].replace('<span class="version">v' + previous.version, '<span class="version">v' + version));
  expect(after.slice(4)).toEqual(before.slice(4));
});

test("invalid versions leave every file unchanged", async () => {
  const directory = await fixture();
  const before = await snapshot(directory);
  for (const version of ["v0.1.3", "0.1", "01.2.3", "0.2.0-beta.01", "0.2.0+build", "0.1.3\n", "0.1.3; echo invalid"]) {
    await expect(bumpVersion(directory, version)).rejects.toThrow("Expected a version");
  }
  expect(await snapshot(directory)).toEqual(before);
});

test("inconsistent Cargo versions stop the bump before any writes", async () => {
  const directory = await fixture();
  const path = join(directory, "Cargo.toml");
  const contents = await readFile(path, "utf8");
  const version = TOML.parse(contents).package.version;
  await writeFile(path, contents.replace('version = "' + version + '"', 'version = "9.9.9"'));
  const before = await snapshot(directory);
  await expect(bumpVersion(directory, "0.1.3")).rejects.toThrow("must match");
  expect(await snapshot(directory)).toEqual(before);
});

test("a missing documentation badge stops the bump before any writes", async () => {
  const directory = await fixture();
  await writeFile(join(directory, "docs/index.html"), "<html></html>\n");
  const before = await snapshot(directory);
  await expect(bumpVersion(directory, "0.1.3")).rejects.toThrow("docs/index.html");
  expect(await snapshot(directory)).toEqual(before);
});
