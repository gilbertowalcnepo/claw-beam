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

test("CLI send prints real code but bundle stores only masked hint and PAKE verifier/transcript artifacts", () => {
  const { tempDir, filePath } = makeTempFile();

  const sendResult = spawnSync("node", [cliPath, "send", filePath], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(sendResult.status, 0);
  assert.match(sendResult.stdout, /beam code: \d{1,2}-[a-z]+-[a-z]+/);

  const bundlePath = path.join(tempDir, ".out", "artifact.txt.beam.json");
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
  assert.equal(bundle.schema, "claw-beam.bundle.v3");
  assert.equal(bundle.security.raw_code_stored_in_bundle, false);
  assert.equal(bundle.security.pake_enabled, true);
  assert.equal(bundle.handshake.status, "sender-prepared");
  assert.match(bundle.handshake.transcript_hash, /^[a-f0-9]{64}$/);
  assert.ok(bundle.handshake.verifier);
  assert.ok(bundle.handshake.sender_message);
  assert.ok(bundle.handshake.receiver_message);
  assert.ok(bundle.pake_shared_secret_wrap);
  assert.match(bundle.beam_code_hint, /^\d{1,2}-[a-z]+-\*\*\*\*$/);
  const codeMatch = sendResult.stdout.match(/beam code: (\d{1,2}-[a-z]+-[a-z]+)/);
  assert.ok(codeMatch);
  const emittedCode = codeMatch[1];
  assert.equal(JSON.stringify(bundle).includes(emittedCode), false);
});

test("CLI receive requires explicit accept phase", () => {
  const { tempDir, filePath } = makeTempFile();

  const sendResult = spawnSync("node", [cliPath, "send", filePath], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(sendResult.status, 0);

  const bundlePath = path.join(tempDir, ".out", "artifact.txt.beam.json");
  const codeMatch = sendResult.stdout.match(/beam code: (\d{1,2}-[a-z]+-[a-z]+)/);
  assert.ok(codeMatch);

  const receiveResult = spawnSync("node", [cliPath, "receive", bundlePath, codeMatch[1]], {
    cwd: tempDir,
    encoding: "utf-8",
  });

  assert.equal(receiveResult.status, 1);
  assert.match(receiveResult.stderr, /Beam bundle must be accepted before receive\./);
});

test("CLI accept requires correct code and then enables receive", () => {
  const { tempDir, filePath } = makeTempFile();

  const sendResult = spawnSync("node", [cliPath, "send", filePath], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(sendResult.status, 0);

  const bundlePath = path.join(tempDir, ".out", "artifact.txt.beam.json");
  const codeMatch = sendResult.stdout.match(/beam code: (\d{1,2}-[a-z]+-[a-z]+)/);
  assert.ok(codeMatch);
  const beamCode = codeMatch[1];

  const badAccept = spawnSync("node", [cliPath, "accept", bundlePath, "9-wrong-code", "per"], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(badAccept.status, 1);
  assert.match(badAccept.stderr, /Invalid beam code or corrupted bundle\./);

  const acceptResult = spawnSync("node", [cliPath, "accept", bundlePath, beamCode, "per"], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(acceptResult.status, 0);
  assert.match(acceptResult.stdout, /transfer_status: accepted/);
  assert.match(acceptResult.stdout, /key_wrap_stage: pake-accepted-session/);
  assert.match(acceptResult.stdout, /handshake_status: receiver-accepted/);
});

test("CLI receive shows clean error for wrong code", () => {
  const { tempDir, filePath } = makeTempFile();

  const sendResult = spawnSync("node", [cliPath, "send", filePath], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(sendResult.status, 0);

  const bundlePath = path.join(tempDir, ".out", "artifact.txt.beam.json");
  const codeMatch = sendResult.stdout.match(/beam code: (\d{1,2}-[a-z]+-[a-z]+)/);
  assert.ok(codeMatch);
  const beamCode = codeMatch[1];

  const acceptResult = spawnSync("node", [cliPath, "accept", bundlePath, beamCode, "per"], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(acceptResult.status, 0);

  const receiveResult = spawnSync("node", [cliPath, "receive", bundlePath, "9-wrong-code", "--keep-bundle"], {
    cwd: tempDir,
    encoding: "utf-8",
  });

  assert.equal(receiveResult.status, 1);
  assert.match(receiveResult.stderr, /Invalid beam code or corrupted bundle\./);
  assert.doesNotMatch(receiveResult.stderr, /Decipheriv\.final/);
});

test("CLI accept then receive completes flow", () => {
  const { tempDir, filePath } = makeTempFile();

  const sendResult = spawnSync("node", [cliPath, "send", filePath], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(sendResult.status, 0);

  const bundlePath = path.join(tempDir, ".out", "artifact.txt.beam.json");
  const codeMatch = sendResult.stdout.match(/beam code: (\d{1,2}-[a-z]+-[a-z]+)/);
  assert.ok(codeMatch);
  const beamCode = codeMatch[1];

  const acceptResult = spawnSync("node", [cliPath, "accept", bundlePath, beamCode, "per"], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(acceptResult.status, 0);
  assert.match(acceptResult.stdout, /transfer_status: accepted/);

  const receiveResult = spawnSync("node", [cliPath, "receive", bundlePath, beamCode, "--keep-bundle"], {
    cwd: tempDir,
    encoding: "utf-8",
  });
  assert.equal(receiveResult.status, 0);
  assert.match(receiveResult.stdout, /beam received:/);
  assert.match(receiveResult.stdout, /transfer_status: consumed/);
  assert.match(receiveResult.stdout, /handshake_status: completed/);
});
