import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { platforms } from "./platforms.mjs";

const directory = resolve(process.argv[2] ?? "dist/npm");
const main = JSON.parse(await readFile(join(directory, "serve-rs/package.json"), "utf8"));
const source = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (main.name !== source.name || main.version !== source.version) {
  throw new Error("Staged release does not match the source package version");
}
for (const [name, platform] of Object.entries(platforms)) {
  const packageName = `serve-rs-${name}`;
  const native = JSON.parse(await readFile(join(directory, packageName, "package.json"), "utf8"));
  if (native.name !== packageName || native.version !== main.version ||
      main.optionalDependencies[packageName] !== main.version ||
      native.os?.[0] !== platform.os || native.cpu?.[0] !== platform.cpu) {
    throw new Error(`Invalid release package: ${packageName}`);
  }
  await access(join(directory, packageName, "bin", platform.os === "win32" ? "serve-rs.exe" : "serve-rs"));
}
console.log(`Release ${main.version} has all ${Object.keys(platforms).length} native packages.`);
