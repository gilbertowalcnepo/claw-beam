import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = "/home/declanops/.openclaw/workspace/clawboard-common/shared/development/claw-beam";
const cliPath = path.join(repoRoot, "bin", "claw-beam.js");

function makeTempFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-cli-"));
  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload for cli\n", "utf-8");
  return { tempDir, filePath };
}

test("CLI receive shows clean error for wrong code", () => {
  const { tempDir, filePath } = makeTempFile();

  const sendResult = spawnSync("node", [cliPath, "send", filePath], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(sendResult.status, 0);

  const bundlePath = path.join(tempDir, ".out", "artifact.txt.beam.json");
  const receiveResult = spawnSync("node", [cliPath, "receive", bundlePath, "9-wrong-code"], {
    cwd: tempDir,
    encoding: "utf-8",
  });

  assert.equal(receiveResult.status, 1);
  assert.match(receiveResult.stderr, /Invalid beam code or corrupted bundle\./);
  assert.doesNotMatch(receiveResult.stderr, /Decipheriv\.final/);
});
