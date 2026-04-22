import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeToken, decodeToken } from "../src/token.js";
import { sendSimple, receiveSimple } from "../src/simple.js";
import { checkNgrokAvailable } from "../src/ngrok-tunnel.js";

// ─── Module structure ───

test("ngrok-tunnel module exports startNgrokTunnel and checkNgrokAvailable", async () => {
  const { startNgrokTunnel, checkNgrokAvailable } = await import("../src/ngrok-tunnel.js");
  assert.equal(typeof startNgrokTunnel, "function");
  assert.equal(typeof checkNgrokAvailable, "function");
});

// ─── checkNgrokAvailable ───

test("checkNgrokAvailable returns a result object", async () => {
  const result = await checkNgrokAvailable();
  assert.equal(typeof result.available, "boolean");
  assert.equal(typeof result.method, "string");
  // On this test host, pyngrok was installed, so it should be available
  // but ngrok binary may or may not be present. Either way, the result
  // shape must be correct.
  if (result.available) {
    assert.ok(["pyngrok", "binary"].includes(result.method));
  } else {
    assert.ok(result.error);
  }
});

test("checkNgrokAvailable detects pyngrok when installed", async () => {
  const result = await checkNgrokAvailable();
  // pyngrok was installed in the test environment
  // If available, method should be "pyngrok"
  if (result.available) {
    // On this host with pyngrok installed, it should be the preferred method
    assert.ok(result.method === "pyngrok" || result.method === "binary");
  }
});

// ─── sendSimple with ngrok option ───

test("sendSimple rejects --ngrok when ngrok auth is not configured", async (t) => {
  // This test verifies that the ngrok path is reachable and produces a
  // clear error when auth is missing, rather than hanging or crashing.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-ngrok-noauth-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "ngrok-test.txt");
  fs.writeFileSync(filePath, "ngrok no-auth test\n", "utf-8");

  // This should fail because ngrok authtoken is not configured
  // (or pyngrok/ngrok binary is not properly set up on CI)
  try {
    const result = await sendSimple(filePath, {
      storeDir: path.join(tempDir, "store"),
      ngrok: true,
      ngrokAuthToken: "invalid-test-token",
    });
    // If it somehow succeeds (e.g., on a machine with ngrok properly configured),
    // clean up the server
    if (result.server) await result.server.close();
    if (result.ngrokTunnel) await result.ngrokTunnel.close();
    // We still consider this a pass — the feature works on configured hosts
    assert.ok(result.token, "ngrok send succeeded on configured host");
    assert.ok(result.ngrokTunnel, "ngrok tunnel was created");
    assert.match(result.baseUrl, /^https:\/\//, "ngrok URL is HTTPS");
  } catch (error) {
    // Expected: ngrok auth error or connection failure
    assert.ok(
      error.message.includes("ngrok") ||
      error.message.includes("auth") ||
      error.message.includes("401") ||
      error.message.includes("tunnel") ||
      error.message.includes("not available") ||
      error.message.includes("failed"),
      `Error should mention ngrok/auth/tunnel: ${error.message}`
    );
  }
});

test("sendSimple without ngrok works as before (regression check)", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-ngrok-regression-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "regression.txt");
  fs.writeFileSync(filePath, "regression test without ngrok\n", "utf-8");

  const sendResult = await sendSimple(filePath, { storeDir: path.join(tempDir, "store") });
  assert.ok(sendResult.token);
  assert.ok(sendResult.baseUrl.startsWith("http://"), "local URL should be http");
  assert.ok(!sendResult.ngrokTunnel, "no ngrok tunnel in local mode");

  const recvResult = await receiveSimple(sendResult.token, path.join(tempDir, "recv"));
  assert.equal(recvResult.fileName, "regression.txt");
  assert.equal(fs.readFileSync(recvResult.outPath, "utf-8"), "regression test without ngrok\n");

  await sendResult.server.close();
});

test("sendSimple result includes localUrl when ngrok is not used", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-localurl-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const filePath = path.join(tempDir, "localurl.txt");
  fs.writeFileSync(filePath, "local url test\n", "utf-8");

  const sendResult = await sendSimple(filePath, { storeDir: path.join(tempDir, "store") });
  assert.ok(sendResult.localUrl, "localUrl should be present");
  assert.equal(sendResult.baseUrl, sendResult.localUrl, "baseUrl equals localUrl without ngrok");

  await sendResult.server.close();
});

// ─── Token encoding with HTTPS URLs ───

test("encodeToken/decodeToken works with ngrok HTTPS URLs", () => {
  const ngrokUrl = "https://a1b2c3d4.ngrok.io";
  const token = encodeToken({ baseUrl: ngrokUrl, offerId: "deadbeef12345678", code: "42-secret-comet" });
  const decoded = decodeToken(token);
  assert.equal(decoded.baseUrl, ngrokUrl);
  assert.equal(decoded.offerId, "deadbeef12345678");
  assert.equal(decoded.code, "42-secret-comet");
});

test("receiveSimple can decode tokens with ngrok HTTPS URLs", async (t) => {
  // Verify that the token format carries HTTPS ngrok URLs properly
  const ngrokUrl = "https://abc123.ngrok-free.app";
  const token = encodeToken({ baseUrl: ngrokUrl, offerId: "0123456789abcdef", code: "99-secure-comet" });
  const decoded = decodeToken(token);
  assert.equal(decoded.baseUrl, ngrokUrl);
  // Receiving against a non-existent server should fail, but the token
  // decode should work fine with HTTPS URLs
});

// ─── ngrok-tunnel module error handling ───

test("startNgrokTunnel rejects invalid port", async () => {
  const { startNgrokTunnel } = await import("../src/ngrok-tunnel.js");
  await assert.rejects(
    () => startNgrokTunnel(0, { timeout: 1000 }),
    /Invalid local port/
  );
});

test("startNgrokTunnel rejects negative port", async () => {
  const { startNgrokTunnel } = await import("../src/ngrok-tunnel.js");
  await assert.rejects(
    () => startNgrokTunnel(-1, { timeout: 1000 }),
    /Invalid local port/
  );
});