import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeBeamBundle, acceptBeamBundle, receiveBeamBundle } from "../src/claw-beam.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-debug-"));
const sendDir = path.join(tempDir, "send");
const recvDir = path.join(tempDir, "recv");
fs.mkdirSync(sendDir, { recursive: true });
fs.mkdirSync(recvDir, { recursive: true });
const filePath = path.join(tempDir, "artifact.txt");
fs.writeFileSync(filePath, "beam payload for debug\n", "utf-8");

try {
  const { beamCode, bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  console.log(JSON.stringify({ step: "send", beamCode, bundlePath }, null, 2));
  const accepted = await acceptBeamBundle(bundlePath, beamCode, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });
  console.log(JSON.stringify({ step: "accept", status: accepted.transfer.status, key_wrap_stage: accepted.session.key_wrap_stage }, null, 2));
  const received = await receiveBeamBundle(bundlePath, beamCode, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:55:00.000Z"),
  });
  console.log(JSON.stringify({ step: "receive", outPath: received.outPath, status: received.bundle.transfer.status }, null, 2));
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
