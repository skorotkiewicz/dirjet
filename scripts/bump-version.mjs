import { TOML } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Updates the release version after validating every source file. */
export async function bumpVersion(directory, version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version ?? "");
  if (!match || match[0] !== version || match[4]?.split(".").some((part) => /^0\d+$/.test(part))) {
    throw new Error("Expected a version such as 0.1.3 or 0.2.0-beta.1");
  }

  const files = ["package.json", "Cargo.toml", "Cargo.lock", "docs/index.html"];
  const contents = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
  const manifest = JSON.parse(contents[0]);
  const cargo = TOML.parse(contents[1]).package;
  const packages = TOML.parse(contents[2]).package.filter((entry) => entry.name === manifest.name);
  if (cargo.name !== manifest.name || cargo.version !== manifest.version ||
      packages.length !== 1 || packages[0].version !== manifest.version) {
    throw new Error("Cargo and npm names and versions must match before bumping");
  }

  const escapedName = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    /(^\s*"version"\s*:\s*")[^"]+("\s*,?)/m,
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    new RegExp('(\\[\\[package\\]\\]\\r?\\nname = "' + escapedName + '"\\r?\\nversion = ")[^"]+(")'),
    /(<span class="version">)v[^<]+(<\/span>)/,
  ];
  const updated = contents.map((text, index) => {
    const found = patterns[index].exec(text);
    const prefix = index === 3 ? "v" : "";
    if (!found || found[0] !== found[1] + prefix + manifest.version + found[2]) {
      throw new Error("Missing or inconsistent version in " + files[index]);
    }
    return text.replace(patterns[index], (_, before, after) => before + prefix + version + after);
  });

  for (const [index, file] of files.entries()) {
    await writeFile(join(directory, file), updated[index]);
  }
  return manifest.version;
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: just bump <version>");
    const version = process.argv[2];
    const previous = await bumpVersion(fileURLToPath(new URL("../", import.meta.url)), version);
    console.log("Updated release version: " + previous + " -> " + version);
  } catch (error) {
    console.error("dirjet: " + error.message);
    process.exitCode = 1;
  }
}
