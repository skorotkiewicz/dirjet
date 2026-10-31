import { resolve } from "node:path";
import { verifyRelease } from "./release-files.mjs";

try {
  if (process.env.npm_command === "publish") {
    throw new Error("Publish the staged npm tarball through the release workflow. The source checkout has no generated binary manifest.");
  }
  const result = await verifyRelease(resolve(process.argv[2] ?? "dist"));
  console.log("Release " + result.version + " has one npm launcher and all " + Object.keys(result.binaries).length + " verified native binaries.");
} catch (error) {
  console.error("djet: " + error.message);
  process.exitCode = 1;
}
