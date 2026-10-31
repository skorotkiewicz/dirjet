import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publishNpm } from "../scripts/publish-npm.mjs";

const source = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const names = [source.name];
const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "serve-rs-publish-"));
  temporary.push(directory);
  const integrity = new Map();
  for (const name of names) {
    const contents = `archive fixture for ${name}`;
    await writeFile(join(directory, `${name}-${source.version}.tgz`), contents);
    integrity.set(name, "sha512-" + createHash("sha512").update(contents).digest("base64"));
  }
  return { directory, integrity };
}

test("publishes only the single serve-rs npm archive", async () => {
  const { directory } = await fixture();
  const published = [];
  const checked = [];
  await publishNpm(directory, {
    fetchImpl: async (url) => { checked.push(url); return new Response(null, { status: 404 }); },
    run: async (args) => {
      expect(checked.length).toBe(names.length);
      expect(args).toContain("--access");
      expect(args).toContain("public");
      expect(args).toContain(source.version.includes("-") ? "next" : "latest");
      published.push(args[1]);
    }, log: () => {},
  });
  expect(published).toEqual(names.map((name) => join(directory, `${name}-${source.version}.tgz`)));
});

test("retry skips matching archives that are already published", async () => {
  const { directory, integrity } = await fixture();
  const published = [];
  await publishNpm(directory, {
    fetchImpl: async (url) => url.includes(names[0] + "/")
      ? Response.json({ dist: { integrity: integrity.get(names[0]) } })
      : new Response(null, { status: 404 }),
    run: async (args) => { published.push(args[1]); }, log: () => {},
  });
  expect(published).toEqual(names.slice(1).map((name) => join(directory, `${name}-${source.version}.tgz`)));
});

test("different contents for an existing version prevent every publish", async () => {
  const { directory } = await fixture();
  const published = [];
  await expect(publishNpm(directory, {
    fetchImpl: async (url) => url.includes(source.name + "/")
      ? Response.json({ dist: { integrity: "sha512-different" } })
      : new Response(null, { status: 404 }),
    run: async (args) => { published.push(args); }, log: () => {},
  })).rejects.toThrow("already exists on npm with different contents");
  expect(published).toHaveLength(0);
});

test("registry errors do not count as missing packages", async () => {
  const { directory } = await fixture();
  const published = [];
  await expect(publishNpm(directory, {
    fetchImpl: async () => new Response(null, { status: 503 }),
    run: async (args) => { published.push(args); }, log: () => {},
  })).rejects.toThrow("registry returned HTTP 503");
  expect(published).toHaveLength(0);
});

test("missing launcher archive prevents publishing or contacting the registry", async () => {
  const { directory } = await fixture();
  await rm(join(directory, `${names[0]}-${source.version}.tgz`));
  const calls = [];
  await expect(publishNpm(directory, {
    fetchImpl: async () => { calls.push("fetch"); return new Response(null, { status: 404 }); },
    run: async () => { calls.push("publish"); }, log: () => {},
  })).rejects.toThrow("Missing release archive");
  expect(calls).toHaveLength(0);
});

test("a failed npm publish reports the error", async () => {
  const { directory } = await fixture();
  const published = [];
  await expect(publishNpm(directory, {
    fetchImpl: async () => new Response(null, { status: 404 }),
    run: async (args) => { published.push(args[1]); throw new Error("authentication failed"); },
    log: () => {},
  })).rejects.toThrow("authentication failed");
  expect(published).toEqual([join(directory, `${names[0]}-${source.version}.tgz`)]);
});

test("read-only preflight checks integrity without publishing", async () => {
  const { directory } = await fixture();
  const published = [];
  await publishNpm(directory, {
    checkOnly: true,
    fetchImpl: async () => new Response(null, { status: 404 }),
    run: async (args) => { published.push(args); }, log: () => {},
  });
  expect(published).toHaveLength(0);
});
