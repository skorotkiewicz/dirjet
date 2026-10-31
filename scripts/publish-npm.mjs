import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { platforms } from "./platforms.mjs";

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

/**
 * Publishes native packages before the launcher, using the exact packed archives.
 * Matching published archives are skipped so failed publishing jobs can resume.
 */
export async function publishNpm(directory, { fetchImpl = fetch, run = runNpm, log = console.log } = {}) {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const version = manifest.version;
  const names = [...Object.keys(platforms).map((name) => "serve-rs-" + name), manifest.name];
  const archives = [];
  // Read every archive before making any registry changes.
  for (const name of names) {
    const file = resolve(directory, name + "-" + version + ".tgz");
    let contents;
    try {
      contents = await readFile(file);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("Missing release archive: " + file);
      throw error;
    }
    archives.push({
      name, file,
      integrity: "sha512-" + createHash("sha512").update(contents).digest("base64"),
      published: false,
    });
  }
  // Check the entire release before publishing. A registry failure is not a
  // missing package, and an existing version must contain the same archive.
  for (const archive of archives) {
    const response = await fetchImpl(registry + "/" + encodeURIComponent(archive.name) + "/" + encodeURIComponent(version));
    if (response.status === 404) continue;
    if (!response.ok) {
      throw new Error("Could not check " + archive.name + "@" + version + ": registry returned HTTP " + response.status);
    }
    const existing = await response.json();
    if (!(existing.dist?.integrity ?? "").split(/\s+/).includes(archive.integrity)) {
      throw new Error(
        archive.name + "@" + version + " already exists on npm with different contents. " +
        "Re-run only the failed jobs to reuse the original archives, or bump the version.",
      );
    }
    archive.published = true;
  }
  const tag = version.includes("-") ? "next" : "latest";
  for (const archive of archives) {
    if (archive.published) {
      log("Already published " + archive.name + "@" + version + "; archive matches, skipping.");
      continue;
    }
    log("Publishing " + archive.name + "@" + version + " with tag " + tag);
    await run(["publish", archive.file, "--access", "public", "--tag", tag, "--registry", registry]);
  }
  log("All native packages and " + manifest.name + "@" + version + " are published.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await publishNpm(process.argv[2] ?? join("dist", "tarballs")).catch((error) => {
    console.error("serve-rs: " + error.message);
    process.exitCode = 1;
  });
}
