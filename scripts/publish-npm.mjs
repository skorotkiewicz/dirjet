import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const registry = "https://registry.npmjs.org";

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error("npm publish failed" + (signal ? " with signal " + signal : " with exit code " + code)));
    });
  });
}

/** Checks immutable archive integrity before publishing the single npm launcher. */
export async function publishNpm(directory, { fetchImpl = fetch, run = runNpm, log = console.log, checkOnly = false } = {}) {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const name = manifest.name;
  const version = manifest.version;
  const file = resolve(directory, name + "-" + version + ".tgz");
  let contents;
  try {
    contents = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Missing release archive: " + file);
    throw error;
  }
  const integrity = "sha512-" + createHash("sha512").update(contents).digest("base64");
  const response = await fetchImpl(registry + "/" + encodeURIComponent(name) + "/" + encodeURIComponent(version));
  if (response.ok) {
    const existing = await response.json();
    if (!(existing.dist?.integrity ?? "").split(/\s+/).includes(integrity)) {
      throw new Error(
        name + "@" + version + " already exists on npm with different contents. " +
        "Re-run only the failed jobs to reuse the original archives, or bump the version.",
      );
    }
    log("Already published " + name + "@" + version + "; archive matches, skipping.");
    return;
  }
  if (response.status !== 404) {
    throw new Error("Could not check " + name + "@" + version + ": registry returned HTTP " + response.status);
  }
  if (checkOnly) {
    log("npm release integrity checked. No packages published.");
    return;
  }
  const tag = version.includes("-") ? "next" : "latest";
  log("Publishing " + name + "@" + version + " with tag " + tag);
  await run(["publish", file, "--access", "public", "--tag", tag, "--registry", registry]);
  log(name + "@" + version + " is published.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await publishNpm(process.argv[2] ?? join("dist", "tarballs"), { checkOnly: process.argv.includes("--check") }).catch((error) => {
    console.error("djet: " + error.message);
    process.exitCode = 1;
  });
}
