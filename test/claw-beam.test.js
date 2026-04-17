import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBeamBundle,
  receiveBeamBundle,
  renderOfferSummary,
  writeBeamBundle,
} from "../src/claw-beam.js";

test("createBeamBundle builds encrypted prototype metadata for a file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "hello beam\n", "utf-8");

  const bundle = createBeamBundle(filePath, new Date("2026-04-17T06:50:00.000Z"));

  assert.equal(bundle.schema, "claw-beam.bundle.v1");
  assert.equal(bundle.file.name, "artifact.txt");
  assert.equal(bundle.file.size_bytes, Buffer.byteLength("hello beam\n"));
  assert.equal(bundle.security.prototype_only, true);
  assert.equal(bundle.security.encrypted_payload, true);
  assert.equal(bundle.payload.algorithm, "aes-256-gcm+scrypt");
  assert.equal(bundle.consumed_at, null);
  assert.match(bundle.beam_code, /^\d{1,2}-[a-z]+-[a-z]+$/);
});

test("writeBeamBundle and receiveBeamBundle perform encrypted round-trip", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundle, bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  const result = receiveBeamBundle(bundlePath, bundle.beam_code, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:55:00.000Z"),
  });
  const recovered = fs.readFileSync(result.outPath, "utf-8");
  const updatedBundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));

  assert.equal(recovered, "beam payload\n");
  assert.equal(path.basename(result.outPath), "artifact.txt");
  assert.equal(updatedBundle.consumed_at, "2026-04-17T06:55:00.000Z");
});

test("receiveBeamBundle rejects wrong code", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  fs.mkdirSync(sendDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));

  assert.throws(() => receiveBeamBundle(bundlePath, "9-wrong-code", tempDir));
});

test("receiveBeamBundle removes bundle by default after consume", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundle, bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  receiveBeamBundle(bundlePath, bundle.beam_code, recvDir, {
    now: new Date("2026-04-17T06:56:00.000Z"),
  });

  assert.equal(fs.existsSync(bundlePath), false);
});

test("receiveBeamBundle rejects already-consumed bundle", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundle, bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  receiveBeamBundle(bundlePath, bundle.beam_code, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:56:00.000Z"),
  });

  assert.throws(() => receiveBeamBundle(bundlePath, bundle.beam_code, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:57:00.000Z"),
  }));
});

test("renderOfferSummary exposes readable fields", () => {
  const summary = renderOfferSummary({
    schema: "claw-beam.bundle.v1",
    beam_code: "7-neon-comet",
    created_at: "2026-04-17T06:50:00.000Z",
    expires_at: "2026-04-17T07:05:00.000Z",
    consumed_at: null,
    file: {
      name: "artifact.txt",
      size_bytes: 42,
      sha256: "abc123",
    },
    payload: {
      algorithm: "aes-256-gcm+scrypt",
    },
    security: {
      prototype_only: true,
      encrypted_payload: true,
    },
  });

  assert.match(summary, /beam code: 7-neon-comet/);
  assert.match(summary, /file: artifact.txt/);
  assert.match(summary, /consumed_at: not-consumed/);
  assert.match(summary, /encrypted_payload: true/);
  assert.match(summary, /algorithm: aes-256-gcm\+scrypt/);
});
