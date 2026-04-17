import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acceptBeamBundle,
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
  assert.equal(bundle.transfer.status, "awaiting-accept");
  assert.equal(bundle.transfer.accepted_at, null);
  assert.equal(bundle.consumed_at, null);
  assert.match(bundle.beam_code, /^\d{1,2}-[a-z]+-[a-z]+$/);
});

test("acceptBeamBundle records explicit receiver acceptance", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  fs.mkdirSync(sendDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  const accepted = acceptBeamBundle(bundlePath, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });

  assert.equal(accepted.transfer.status, "accepted");
  assert.equal(accepted.transfer.accepted_at, "2026-04-17T06:52:00.000Z");
  assert.equal(accepted.transfer.receiver_label, "per");
});

test("receiveBeamBundle requires acceptance before receive", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundle, bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));

  assert.throws(() => receiveBeamBundle(bundlePath, bundle.beam_code, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:55:00.000Z"),
  }));
});

test("accepted bundle can complete encrypted round-trip", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundle, bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  acceptBeamBundle(bundlePath, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });

  const result = receiveBeamBundle(bundlePath, bundle.beam_code, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:55:00.000Z"),
  });
  const recovered = fs.readFileSync(result.outPath, "utf-8");
  const updatedBundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));

  assert.equal(recovered, "beam payload\n");
  assert.equal(path.basename(result.outPath), "artifact.txt");
  assert.equal(updatedBundle.transfer.status, "consumed");
  assert.equal(updatedBundle.transfer.receiver_label, "per");
  assert.equal(updatedBundle.consumed_at, "2026-04-17T06:55:00.000Z");
});

test("receiveBeamBundle rejects wrong code", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  fs.mkdirSync(sendDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundle, bundlePath } = writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  acceptBeamBundle(bundlePath, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });

  assert.throws(() => receiveBeamBundle(bundlePath, "9-wrong-code", tempDir, {
    deleteBundleOnConsume: false,
  }));
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
  acceptBeamBundle(bundlePath, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });
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
  acceptBeamBundle(bundlePath, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });
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
    transfer: {
      status: "accepted",
      accepted_at: "2026-04-17T06:52:00.000Z",
      receiver_label: "per",
    },
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
  assert.match(summary, /transfer_status: accepted/);
  assert.match(summary, /accepted_at: 2026-04-17T06:52:00.000Z/);
  assert.match(summary, /receiver_label: per/);
  assert.match(summary, /file: artifact.txt/);
  assert.match(summary, /consumed_at: not-consumed/);
  assert.match(summary, /encrypted_payload: true/);
  assert.match(summary, /algorithm: aes-256-gcm\+scrypt/);
});
