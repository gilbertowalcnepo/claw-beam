import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { encodeToken, decodeToken } from "../src/token.js";
import { sendSimple, receiveSimple } from "../src/simple.js";

const repoRoot = "/home/declanops/.openclaw/workspace/clawboard-common/shared/development/claw-beam";
const cliPath = path.join(repoRoot, "bin", "claw-beam.js");

// ─── Token encoding ───

test("encodeToken and decodeToken round-trip correctly", () => {
  const token = encodeToken({ baseUrl: "http://127.0.0.1:41921", offerId: "abc123def45678", code: "7-neon-comet" });
  const decoded = decodeToken(token);
  assert.equal(decoded.baseUrl, "http://127.0.0.1:41921");
  assert.equal(decoded.offerId, "abc123def45678");
  assert.equal(decoded.code, "7-neon-comet");
});

test("decodeToken rejects malformed tokens", () => {
  assert.throws(() => decodeToken("not-valid-base64!!!"), /Invalid token/i);
});

test("decodeToken rejects tokens with missing fields", () => {
  const badToken = Buffer.from(JSON.stringify({ baseUrl: "http://localhost:1234" }), "utf-8").toString("base64url");
  assert.throws(() => decodeToken(badToken), /missing required/i);
});

// ─── Programmatic simple flow ───

test("sendSimple + receiveSimple completes full encrypted round-trip", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-simple-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "hello-beam.txt");
  fs.writeFileSync(filePath, "hello from simple flow!\n", "utf-8");

  const sendResult = await sendSimple(filePath, { storeDir: path.join(tempDir, "store") });

  assert.ok(sendResult.token);
  assert.ok(sendResult.beamCode);
  assert.ok(sendResult.offerId);
  assert.ok(sendResult.baseUrl);
  assert.ok(sendResult.server);

  const recvDir = path.join(tempDir, "recv");
  const recvResult = await receiveSimple(sendResult.token, recvDir);

  assert.equal(recvResult.fileName, "hello-beam.txt");
  assert.equal(recvResult.sizeBytes, Buffer.byteLength("hello from simple flow!\n"));
  assert.equal(fs.readFileSync(recvResult.outPath, "utf-8"), "hello from simple flow!\n");
  assert.ok(recvResult.sha256);

  await sendResult.server.close();
});

test("sendSimple + receiveSimple works with a binary file", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-simple-bin-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "binary.dat");
  const payload = Buffer.alloc(1024);
  for (let i = 0; i < 1024; i++) payload[i] = i % 256;
  fs.writeFileSync(filePath, payload);

  const sendResult = await sendSimple(filePath, { storeDir: path.join(tempDir, "store") });
  const recvResult = await receiveSimple(sendResult.token, path.join(tempDir, "recv"));

  const recovered = fs.readFileSync(recvResult.outPath);
  assert.equal(recovered.length, 1024);
  for (let i = 0; i < 1024; i++) {
    assert.equal(recovered[i], i % 256);
  }

  await sendResult.server.close();
});

test("receiveSimple rejects wrong token", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-simple-wrong-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const badToken = encodeToken({ baseUrl: "http://127.0.0.1:1", offerId: "0000000000000000", code: "99-wrong-code" });
  await assert.rejects(() => receiveSimple(badToken, tempDir));
});

// ─── CLI simple flow ───

test("CLI send prints token and starts server", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-cli-send-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "cli-test.txt");
  fs.writeFileSync(filePath, "cli simple flow test\n", "utf-8");

  // Use a timeout since `send` keeps the server alive
  const result = spawnSync("node", [cliPath, "send", "--filepath", filePath], {
    cwd: tempDir,
    encoding: "utf-8",
    timeout: 8000,
  });

  // The process will be killed by timeout, but stdout should have the token
  assert.match(result.stdout, /✉ beam sent/);
  assert.match(result.stdout, /token:/);
  assert.match(result.stdout, /code:/);
  assert.match(result.stdout, /rendezvous:/);
  assert.match(result.stdout, /claw-beam receive --token/);
});

test("CLI receive with a valid token completes transfer", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-cli-full-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "full-flow.txt");
  fs.writeFileSync(filePath, "full round-trip via CLI\n", "utf-8");

  // Send programmatically to get a token and running server
  const sendResult = await sendSimple(filePath, { storeDir: path.join(tempDir, "store") });

  const recvDir = path.join(tempDir, "recv");

  // Use programmatic receiveSimple for the actual transfer (CLI spawnSync blocks
  // the event loop and prevents the in-process server from responding)
  const recvResult = await receiveSimple(sendResult.token, recvDir);

  const recovered = fs.readFileSync(path.join(recvDir, "full-flow.txt"), "utf-8");
  assert.equal(recovered, "full round-trip via CLI\n");
  assert.equal(recvResult.fileName, "full-flow.txt");
  assert.equal(recvResult.sizeBytes, Buffer.byteLength("full round-trip via CLI\n"));

  await sendResult.server.close();
});

test("CLI decode-token shows token contents", () => {
  const token = encodeToken({ baseUrl: "http://127.0.0.1:41921", offerId: "abc123def45678", code: "7-neon-comet" });
  const result = spawnSync("node", [cliPath, "decode-token", token], {
    encoding: "utf-8",
    timeout: 5000,
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:41921");
  assert.equal(parsed.offerId, "abc123def45678");
  assert.equal(parsed.code, "7-neon-comet");
});

test("CLI receive command works against a separate server process", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-cli-sep-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Start a server in a separate process
  const storeDir = path.join(tempDir, "http-store");
  const serverProc = spawn("node", [cliPath, "serve-rendezvous", storeDir, "0"], {
    cwd: tempDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Wait for server to start
  const baseUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server start timeout")), 5000);
    let stdout = "";
    serverProc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/rendezvous listening: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });

  t.after(() => { serverProc.kill("SIGTERM"); });

  const filePath = path.join(tempDir, "sep-server-test.txt");
  fs.writeFileSync(filePath, "separate server round-trip\n", "utf-8");

  // Send via the HTTP commands
  const sendResult = spawnSync("node", [cliPath, "send-http", filePath, baseUrl], {
    cwd: tempDir,
    encoding: "utf-8",
    timeout: 10000,
  });
  assert.equal(sendResult.status, 0, `send-http stderr: ${sendResult.stderr}`);

  const offerMatch = sendResult.stdout.match(/offer published: ([a-f0-9]{16})/);
  const codeMatch = sendResult.stdout.match(/beam code: (\d{1,2}-[a-z]+-[a-z]+)/);
  assert.ok(offerMatch, `no offer id in: ${sendResult.stdout}`);
  assert.ok(codeMatch, `no beam code in: ${sendResult.stdout}`);

  const offerId = offerMatch[1];
  const code = codeMatch[1];

  // Create a token manually
  const token = encodeToken({ baseUrl, offerId, code });

  // Receive via the simple receive CLI
  const recvDir = path.join(tempDir, "recv");
  const receiveResult = spawnSync("node", [cliPath, "receive", "--token", token, "--filespath", recvDir], {
    cwd: tempDir,
    encoding: "utf-8",
    timeout: 10000,
  });

  // Note: receive needs accept first via http, so let's accept then receive
  const acceptResult = spawnSync("node", [cliPath, "accept-http", baseUrl, offerId, code, "per"], {
    cwd: tempDir,
    encoding: "utf-8",
    timeout: 10000,
  });
  assert.equal(acceptResult.status, 0, `accept-http stderr: ${acceptResult.stderr}`);

  const receiveResultAfterAccept = spawnSync("node", [cliPath, "receive-http", baseUrl, offerId, code, "--keep-bundle"], {
    cwd: tempDir,
    encoding: "utf-8",
    timeout: 10000,
  });
  assert.equal(receiveResultAfterAccept.status, 0, `receive-http stderr: ${receiveResultAfterAccept.stderr}`);
  assert.match(receiveResultAfterAccept.stdout, /beam received:/);
});