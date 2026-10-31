import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { packageRelease, root, stageBinary } from "./release-files.mjs";
import { platforms } from "./platforms.mjs";

const { values } = parseArgs({
  options: {
    platform: { type: "string", default: process.platform + "-" + process.arch },
    binary: { type: "string" },
    out: { type: "string", default: join(root, "dist") },
    local: { type: "boolean", default: false },
  },
});
try {
  const directory = resolve(values.out);
  if (values.binary || values.local) {
    if (!platforms[values.platform]) throw new Error("Unsupported platform: " + values.platform);
    const name = platforms[values.platform].os === "win32" ? "djet.exe" : "djet";
    const binary = resolve(values.binary ?? join(root, "target", "release", name));
    console.log("Staged " + await stageBinary(directory, values.platform, binary));
  }
  if (values.local || !values.binary) {
    console.log("Staged npm launcher " + await packageRelease(directory, { local: values.local }));
    if (values.local) console.log("Local test package only. Use GitHub Actions for a complete release.");
  }
} catch (error) {
  console.error("djet: " + error.message);
  process.exitCode = 1;
}
