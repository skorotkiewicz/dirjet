import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platforms } from "../scripts/platforms.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(names) {
  const directory = await mkdtemp(join(tmpdir(), "serve-rs-release-"));
  temporary.push(directory);
  await mkdir(join(directory, "serve-rs"));
  await writeFile(join(directory, "serve-rs/package.json"), JSON.stringify(source));
  for (const name of names) {
    const platform = platforms[name];
    const packageName = `serve-rs-${name}`;
    const native = join(directory, packageName);
    await mkdir(join(native, "bin"), { recursive: true });
    await writeFile(join(native, "package.json"), JSON.stringify({
      name: packageName, version: source.version, os: [platform.os], cpu: [platform.cpu],
    }));
    await writeFile(join(native, "bin", platform.os === "win32" ? "serve-rs.exe" : "serve-rs"), "test fixture");
  }
  return directory;
}

async function verify(directory) {
  const child = Bun.spawn([process.execPath, "scripts/verify-release.mjs", directory], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("local-only bundle explains all missing platforms and how to build a release", async () => {
  const result = await verify(await fixture(["linux-x64"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Incomplete npm release");
  for (const name of Object.keys(platforms).filter((name) => name !== "linux-x64")) {
    expect(result.stderr).toContain(`serve-rs-${name}/package.json`);
  }
  expect(result.stderr).toContain("Release packages");
  expect(result.stderr).toContain("bun run package");
  expect(result.stderr).not.toContain("ENOENT");
});

test("complete bundle passes verification", async () => {
  const result = await verify(await fixture(Object.keys(platforms)));
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(`Release ${source.version} has all 6 native packages.`);
});

test("bundle with a mismatched version still fails", async () => {
  const directory = await fixture(Object.keys(platforms));
  const path = join(directory, "serve-rs-linux-x64/package.json");
  const native = JSON.parse(await readFile(path, "utf8"));
  native.version = "0.0.0";
  await writeFile(path, JSON.stringify(native));
  const result = await verify(directory);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Invalid release package: serve-rs-linux-x64");
});
