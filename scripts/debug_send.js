import { writeBeamBundle } from "../src/claw-beam.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("missing file path");
  process.exit(1);
}

try {
  const result = await writeBeamBundle(filePath);
  console.log(JSON.stringify({ bundlePath: result.bundlePath, schema: result.bundle.schema }, null, 2));
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
