import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const platform = `${process.platform}-${process.arch}`;
const binaryName = process.platform === "win32" ? "serve-rs.exe" : "serve-rs";
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
let temporary;
let launcher;
let site;

async function command(args, options = {}) {
  const started = performance.now();
  const child = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 100_000, ...options });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    const elapsed = Math.round(performance.now() - started);
    throw new Error(`${args.join(" ")} failed (${code}) after ${elapsed}ms:\n${stdout}\n${stderr}`);
  }
  return stdout;
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "serve-rs-test-"));
  await command(["cargo", "build", "--locked"]);
  const staging = join(temporary, "staging");
  await command([
    process.execPath, "scripts/package.mjs", "--binary", join(root, "target/debug", binaryName),
    "--out", staging,
  ]);
  // Pack and extract the actual release files into the installed package layout.
  const tarballs = join(temporary, "tarballs");
  await mkdir(tarballs);
  const installation = join(temporary, "installation/node_modules");
  await mkdir(installation, { recursive: true });
  for (const name of ["serve-rs", `serve-rs-${platform}`]) {
    await command([process.execPath, "pm", "pack", "--destination", tarballs], { cwd: join(staging, name) });
    const destination = join(installation, name);
    await mkdir(destination);
    await command(["tar", "-xzf", join(tarballs, `${name}-${manifest.version}.tgz`), "-C", destination, "--strip-components=1"]);
  }
  launcher = join(installation, "serve-rs/bin/serve-rs.cjs");
  if (process.platform !== "win32") {
    await mkdir(join(installation, ".bin"));
    await symlink(launcher, join(installation, ".bin/serve-rs"));
  }
  site = join(temporary, "site with spaces");
  await mkdir(site);
  await writeFile(join(site, "example.html"), '<link rel="stylesheet" href="./style.css"><h1>hello</h1>');
  await writeFile(join(site, "style.css"), "body { color: red }");
}, 120_000);

afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

async function withServer(args, callback) {
  const child = Bun.spawn([process.execPath, launcher, ...args, "--port", "0"], {
    cwd: temporary, stdout: "pipe", stderr: "pipe",
  });
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("server startup timed out")), 10_000);
  });
  const stderr = new Response(child.stderr).text();
  try {
    const startup = (async () => {
      let output = "";
      for await (const chunk of child.stdout) {
        output += new TextDecoder().decode(chunk);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) return match[0];
      }
      throw new Error(`server exited before listening: ${await stderr}`);
    })();
    const url = await Promise.race([startup, deadline]);
    clearTimeout(timeout);
    await callback(url);
  } finally {
    clearTimeout(timeout);
    if (process.platform === "win32" && child.exitCode === null) {
      // Windows process termination does not deliver catchable Unix signals.
      await command(["taskkill", "/PID", String(child.pid), "/T", "/F"]);
    } else {
      child.kill("SIGTERM");
    }
    const stopped = await Promise.race([
      child.exited.then(() => true),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); }),
    ]);
    clearTimeout(timeout);
    if (!stopped) {
      child.kill("SIGKILL");
      await child.exited;
      throw new Error("launcher did not forward termination to the server");
    }
  }
}

// Each runtime gets its own budget. Windows CI can take more than five seconds
// to start Node for the first time. Command deadlines expire before test deadlines
// so failures include the command output instead of becoming unhandled rejections.
const cliTestTimeout = 30_000;
const cliCommandTimeout = 20_000;

test("staged npm launcher runs with Bun", async () => {
  expect((await command([process.execPath, launcher, "--version"], { timeout: cliCommandTimeout })).trim())
    .toBe(`serve-rs ${manifest.version}`);
}, cliTestTimeout);

test.skipIf(!Bun.which("node"))("staged npm launcher runs with Node", async () => {
  expect((await command(["node", launcher, "--version"], { timeout: cliCommandTimeout })).trim())
    .toBe(`serve-rs ${manifest.version}`);
}, cliTestTimeout);

test("staged npm launcher forwards CLI exit codes", async () => {
  const child = Bun.spawn([process.execPath, launcher, "--port", "invalid"], {
    stdout: "ignore", stderr: "ignore", timeout: cliCommandTimeout,
  });
  expect(await child.exited).toBe(2);
}, cliTestTimeout);

test("single-file npm command serves HTML and relative assets over HTTP", async () => {
  await withServer([join(site, "example.html")], async (url) => {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<h1>hello</h1>");
    const css = await fetch(`${url}/style.css`);
    expect(css.headers.get("content-type")).toBe("text/css");
    expect(await css.text()).toBe("body { color: red }");
    const head = await fetch(`${url}/style.css`, { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe("19");
    expect(await head.text()).toBe("");
    const cached = await fetch(`${url}/style.css`, {
      method: "HEAD", headers: { "if-modified-since": css.headers.get("last-modified") },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("content-length")).toBe("19");
    expect((await fetch(`${url}/missing.js`)).status).toBe(404);
  });
});

test("directory npm command lists files and serves HTML", async () => {
  await withServer([site], async (url) => {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("example.html");
    const html = await fetch(`${url}/example.html`);
    expect(await html.text()).toContain("<h1>hello</h1>");
  });
});

test("packed manifests contain the CLI and matching platform dependency", async () => {
  const staging = join(temporary, "staging");
  const manifest = JSON.parse(await readFile(join(staging, "serve-rs/package.json"), "utf8"));
  expect(manifest.scripts).toBeUndefined();
  expect(manifest.optionalDependencies[`serve-rs-${platform}`]).toBe(manifest.version);
  const native = JSON.parse(await readFile(join(staging, `serve-rs-${platform}/package.json`), "utf8"));
  expect(native.repository).toEqual(manifest.repository);
  const missing = Bun.spawn([process.execPath, join(staging, "serve-rs/bin/serve-rs.cjs"), "--version"], {
    stdout: "pipe", stderr: "pipe",
  });
  expect(await missing.exited).toBe(1);
  expect(await new Response(missing.stderr).text()).toContain("optional dependencies enabled");
});

test.skipIf(process.platform === "win32")("bunx finds the installed CLI", async () => {
  const cwd = join(temporary, "installation");
  const args = [process.execPath, "x", "--no-install", "--bun", "serve-rs", "--version"];
  expect((await command(args, { cwd })).trim()).toBe(`serve-rs ${manifest.version}`);
  if (Bun.which("node")) {
    expect((await command([process.execPath, "x", "--no-install", "serve-rs", "--version"], { cwd })).trim()).toBe(`serve-rs ${manifest.version}`);
  }
});
