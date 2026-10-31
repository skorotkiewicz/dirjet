import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { platforms } from "./platforms.mjs";

const directory = resolve(process.argv[2] ?? "dist/npm");
async function verify() {
  const expected = ["serve-rs/package.json"];
  for (const [name, platform] of Object.entries(platforms)) {
    const binary = platform.os === "win32" ? "serve-rs.exe" : "serve-rs";
    expected.push(`serve-rs-${name}/package.json`, `serve-rs-${name}/bin/${binary}`);
  }
  const missing = [];
  for (const file of expected) {
    try {
      await access(join(directory, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(file);
    }
  }
  if (missing.length) {
    throw new Error(
      "Incomplete npm release. Missing files:\n" + missing.map((file) => `  ${file}`).join("\n") +
      '\n\n"bun run package" stages only the current platform.\n' +
      'Run the "Release packages" GitHub Actions workflow to build, publish, and release all six platforms:\n' +
      "  https://github.com/skorotkiewicz/serve-rs/actions/workflows/release.yml\n" +
      'For local verification only, download its "npm-packages" artifact, extract it into dist/, and rerun this check.',
    );
  }
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
  }
  console.log(`Release ${main.version} has all ${Object.keys(platforms).length} native packages.`);
}

await verify().catch((error) => {
  console.error(`serve-rs: ${error.message}`);
  process.exitCode = 1;
});
