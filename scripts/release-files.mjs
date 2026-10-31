import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { platforms } from "./platforms.mjs";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));

export async function sourceManifest() {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const cargo = await readFile(join(root, "Cargo.toml"), "utf8");
  if (!cargo.includes('version = "' + manifest.version + '"')) {
    throw new Error("Cargo.toml and package.json versions must match");
  }
  return manifest;
}

export function assetName(platform) {
  if (!Object.hasOwn(platforms, platform)) throw new Error("Unsupported platform: " + platform);
  return "dirjet-" + platform + (platforms[platform].os === "win32" ? ".exe" : "");
}

function releaseBaseUrl(manifest) {
  const repository = manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error("The package repository must be a GitHub HTTPS URL");
  }
  return repository + "/releases/download/v" + manifest.version;
}

function fingerprint(contents) {
  return { sha256: createHash("sha256").update(contents).digest("hex"), size: contents.length };
}

/** Stages a native executable and its build metadata for artifact assembly. */
export async function stageBinary(directory, platform, binary) {
  const manifest = await sourceManifest();
  const file = assetName(platform);
  await mkdir(join(directory, "native"), { recursive: true });
  await mkdir(join(directory, "metadata"), { recursive: true });
  const destination = join(directory, "native", file);
  await copyFile(binary, destination);
  await chmod(destination, 0o755);
  const contents = await readFile(destination);
  if (contents.length === 0) throw new Error("Cannot stage an empty binary");
  const metadata = { version: manifest.version, platform, file, ...fingerprint(contents) };
  await writeFile(join(directory, "metadata", platform + ".json"), JSON.stringify(metadata, null, 2) + "\n");
  return destination;
}

async function collectBinaries(directory, manifest, local) {
  const names = local ? [process.platform + "-" + process.arch] : Object.keys(platforms);
  const missing = [];
  for (const platform of names) {
    for (const file of ["metadata/" + platform + ".json", "native/" + assetName(platform)]) {
      try { await access(join(directory, file)); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        missing.push(file);
      }
    }
  }
  if (missing.length) {
    throw new Error("Incomplete release. Missing files:\n" + missing.map((file) => "  " + file).join("\n") +
      "\n\nRun the Release packages GitHub Actions workflow to build all platforms. " +
      "bun run package builds only a local test package.");
  }
  const binaries = {};
  for (const platform of names) {
    const metadata = JSON.parse(await readFile(join(directory, "metadata", platform + ".json"), "utf8"));
    const file = assetName(platform);
    const expected = fingerprint(await readFile(join(directory, "native", file)));
    if (metadata.version !== manifest.version || metadata.platform !== platform ||
        metadata.file !== file || metadata.sha256 !== expected.sha256 || metadata.size !== expected.size) {
      throw new Error("Invalid binary metadata or checksum: " + platform);
    }
    binaries[platform] = { file, ...expected };
  }
  return { version: manifest.version, baseUrl: releaseBaseUrl(manifest), binaries };
}

/** Packs one JavaScript launcher with checksums for the staged native executables. */
export async function packageRelease(directory, { local = false } = {}) {
  const manifest = await sourceManifest();
  const binaries = await collectBinaries(directory, manifest, local);
  const destination = join(directory, "npm", "dirjet");
  await mkdir(join(destination, "bin"), { recursive: true });
  const { scripts, ...published } = manifest;
  await writeFile(join(destination, "package.json"), JSON.stringify(published, null, 2) + "\n");
  for (const file of ["dirjet.cjs", "binary.cjs"]) {
    await copyFile(join(root, "bin", file), join(destination, "bin", file));
  }
  await chmod(join(destination, "bin", "dirjet.cjs"), 0o755);
  await writeFile(join(destination, "bin", "binaries.json"), JSON.stringify(binaries, null, 2) + "\n");
  for (const file of ["README.md", "LICENSE"]) {
    await copyFile(join(root, file), join(destination, file));
  }
  return destination;
}

/** Verifies all six build artifacts and the exact checksum manifest in npm. */
export async function verifyRelease(directory) {
  const source = await sourceManifest();
  const expected = await collectBinaries(directory, source, false);
  const destination = join(directory, "npm", "dirjet");
  const published = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  if (published.name !== source.name || published.version !== source.version || published.optionalDependencies ||
      published.scripts || published.bin?.["dirjet"] !== "bin/dirjet.cjs") {
    throw new Error("Invalid staged dirjet package");
  }
  const actual = JSON.parse(await readFile(join(destination, "bin", "binaries.json"), "utf8"));
  if (!isDeepStrictEqual(actual, expected)) throw new Error("The npm binary manifest does not match the release assets");
  for (const file of ["dirjet.cjs", "binary.cjs"]) {
    if (!(await readFile(join(root, "bin", file))).equals(await readFile(join(destination, "bin", file)))) {
      throw new Error("Staged launcher differs from source: " + file);
    }
  }
  return expected;
}
