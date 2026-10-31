import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { platforms } from "./platforms.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    platform: { type: "string", default: `${process.platform}-${process.arch}` },
    binary: { type: "string" },
    out: { type: "string", default: join(root, "dist/npm") },
  },
});
const platform = platforms[values.platform];
if (!platform) throw new Error(`Unsupported platform: ${values.platform}`);
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const cargo = await readFile(join(root, "Cargo.toml"), "utf8");
if (!cargo.includes(`version = "${manifest.version}"`)) {
  throw new Error("Cargo.toml and package.json versions must match");
}
for (const name of Object.keys(platforms)) {
  if (manifest.optionalDependencies[`serve-rs-${name}`] !== manifest.version) {
    throw new Error(`Optional dependency serve-rs-${name} must match the package version`);
  }
}
const binaryName = platform.os === "win32" ? "serve-rs.exe" : "serve-rs";
const binary = resolve(values.binary ?? join(root, "target/release", binaryName));
const out = resolve(values.out);
const nativeDir = join(out, `serve-rs-${values.platform}`);
const mainDir = join(out, "serve-rs");
await mkdir(join(nativeDir, "bin"), { recursive: true });
await copyFile(binary, join(nativeDir, "bin", binaryName));
await chmod(join(nativeDir, "bin", binaryName), 0o755);
await writeFile(join(nativeDir, "package.json"), JSON.stringify({
  name: `serve-rs-${values.platform}`,
  version: manifest.version,
  description: `Native ${values.platform} binary for serve-rs`,
  license: manifest.license,
  repository: manifest.repository,
  bugs: manifest.bugs,
  os: [platform.os],
  cpu: [platform.cpu],
  files: ["bin", "LICENSE"],
}, null, 2) + "\n");
await copyFile(join(root, "LICENSE"), join(nativeDir, "LICENSE"));

await mkdir(join(mainDir, "bin"), { recursive: true });
const { scripts, ...publishedManifest } = manifest;
await writeFile(join(mainDir, "package.json"), JSON.stringify(publishedManifest, null, 2) + "\n");
await copyFile(join(root, "bin/serve-rs.cjs"), join(mainDir, "bin/serve-rs.cjs"));
await chmod(join(mainDir, "bin/serve-rs.cjs"), 0o755);
for (const file of ["README.md", "LICENSE"]) {
  await copyFile(join(root, file), join(mainDir, file));
}
console.log(`Staged ${nativeDir}`);
console.log(`Staged ${mainDir}`);
