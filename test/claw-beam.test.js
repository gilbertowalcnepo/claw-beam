import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acceptBeamBundle,
  acceptBeamOffer,
  createBeamBundle,
  inspectBeamOffer,
  publishBeamBundleToRendezvous,
  receiveBeamBundle,
  receiveBeamOffer,
  renderOfferSummary,
  renderRendezvousSummary,
  writeBeamBundle,
} from "../src/claw-beam.js";

test("createBeamBundle builds encrypted prototype metadata for a file without storing raw code and with PAKE verifier/transcript artifacts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "hello beam\n", "utf-8");

  const { bundle, beamCode } = await createBeamBundle(filePath, new Date("2026-04-17T06:50:00.000Z"));

  assert.equal(bundle.schema, "claw-beam.bundle.v3");
  assert.equal(bundle.file.name, "artifact.txt");
  assert.equal(bundle.file.size_bytes, Buffer.byteLength("hello beam\n"));
  assert.equal(bundle.security.prototype_only, true);
  assert.equal(bundle.security.encrypted_payload, true);
  assert.equal(bundle.security.raw_code_stored_in_bundle, false);
  assert.equal(bundle.security.pake_enabled, true);
  assert.equal(bundle.payload.algorithm, "aes-256-gcm");
  assert.equal(bundle.key_wrap.algorithm, "aes-256-gcm");
  assert.equal(bundle.transfer.status, "awaiting-accept");
  assert.equal(bundle.transfer.accepted_at, null);
  assert.equal(bundle.session.key_wrap_stage, "pake-bootstrap");
  assert.equal(bundle.session.pake_suite, "ED25519-SHA256-HKDF-HMAC-SCRYPT");
  assert.ok(bundle.session.pake_salt);
  assert.equal(bundle.handshake.status, "sender-prepared");
  assert.match(bundle.handshake.transcript_hash, /^[a-f0-9]{64}$/);
  assert.ok(bundle.handshake.verifier);
  assert.ok(bundle.handshake.sender_message);
  assert.ok(bundle.handshake.receiver_message);
  assert.ok(bundle.handshake.sender_confirmation);
  assert.ok(bundle.handshake.receiver_confirmation);
  assert.ok(bundle.pake_shared_secret_wrap);
  assert.equal(bundle.consumed_at, null);
  assert.match(bundle.beam_code_hint, /^\d{1,2}-[a-z]+-\*\*\*\*$/);
  assert.match(beamCode, /^\d{1,2}-[a-z]+-[a-z]+$/);
  assert.equal(JSON.stringify(bundle).includes(beamCode), false);
});

test("acceptBeamBundle re-wraps payload key into PAKE accepted session state via verifier-gated recovery", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  fs.mkdirSync(sendDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundle, bundlePath, beamCode } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  const originalCiphertext = bundle.key_wrap.ciphertext;
  const accepted = await acceptBeamBundle(bundlePath, beamCode, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });

  assert.equal(accepted.transfer.status, "accepted");
  assert.equal(accepted.transfer.accepted_at, "2026-04-17T06:52:00.000Z");
  assert.equal(accepted.transfer.receiver_label, "per");
  assert.equal(accepted.session.key_wrap_stage, "pake-accepted-session");
  assert.ok(accepted.session.accept_nonce);
  assert.notEqual(accepted.key_wrap.ciphertext, originalCiphertext);
  assert.equal(accepted.handshake.status, "receiver-accepted");
  assert.match(accepted.handshake.transcript_hash, /^[a-f0-9]{64}$/);
});

test("acceptBeamBundle rejects wrong code", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  fs.mkdirSync(sendDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));

  await assert.rejects(() => acceptBeamBundle(bundlePath, "9-wrong-code", {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  }));
});

test("receiveBeamBundle requires acceptance before receive", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { beamCode, bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));

  await assert.rejects(() => receiveBeamBundle(bundlePath, beamCode, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:55:00.000Z"),
  }));
});

test("accepted bundle can complete encrypted round-trip through PAKE-backed session-wrapped payload key", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { beamCode, bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  await acceptBeamBundle(bundlePath, beamCode, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });

  const result = await receiveBeamBundle(bundlePath, beamCode, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:55:00.000Z"),
  });
  const recovered = fs.readFileSync(result.outPath, "utf-8");
  const updatedBundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));

  assert.equal(recovered, "beam payload\n");
  assert.equal(path.basename(result.outPath), "artifact.txt");
  assert.equal(updatedBundle.transfer.status, "consumed");
  assert.equal(updatedBundle.transfer.receiver_label, "per");
  assert.equal(updatedBundle.session.key_wrap_stage, "pake-accepted-session");
  assert.equal(updatedBundle.handshake.status, "completed");
  assert.match(updatedBundle.handshake.transcript_hash, /^[a-f0-9]{64}$/);
  assert.equal(updatedBundle.consumed_at, "2026-04-17T06:55:00.000Z");
});

test("receiveBeamBundle rejects wrong code", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  fs.mkdirSync(sendDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { beamCode, bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  await acceptBeamBundle(bundlePath, beamCode, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });

  await assert.rejects(() => receiveBeamBundle(bundlePath, "9-wrong-code", tempDir, {
    deleteBundleOnConsume: false,
  }));
});

test("receiveBeamBundle removes bundle by default after consume", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { beamCode, bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  await acceptBeamBundle(bundlePath, beamCode, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });
  await receiveBeamBundle(bundlePath, beamCode, recvDir, {
    now: new Date("2026-04-17T06:56:00.000Z"),
  });

  assert.equal(fs.existsSync(bundlePath), false);
});

test("receiveBeamBundle rejects already-consumed bundle", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam payload\n", "utf-8");

  const { beamCode, bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T06:50:00.000Z"));
  await acceptBeamBundle(bundlePath, beamCode, {
    acceptedAt: new Date("2026-04-17T06:52:00.000Z"),
    receiverLabel: "per",
  });
  await receiveBeamBundle(bundlePath, beamCode, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:56:00.000Z"),
  });

  await assert.rejects(() => receiveBeamBundle(bundlePath, beamCode, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T06:57:00.000Z"),
  }));
});

test("rendezvous publish, accept, inspect, and receive flow works through local mailbox stub", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-rendezvous-"));
  const sendDir = path.join(tempDir, "send");
  const recvDir = path.join(tempDir, "recv");
  const rendezvousDir = path.join(tempDir, "mailbox");
  fs.mkdirSync(sendDir, { recursive: true });
  fs.mkdirSync(recvDir, { recursive: true });

  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "beam rendezvous payload\n", "utf-8");

  const { beamCode, bundlePath } = await writeBeamBundle(filePath, sendDir, new Date("2026-04-17T07:00:00.000Z"));
  const { offerId, receiptPath, receipt } = await publishBeamBundleToRendezvous(bundlePath, rendezvousDir, {
    publishedAt: new Date("2026-04-17T07:01:00.000Z"),
  });

  assert.ok(offerId);
  assert.equal(fs.existsSync(receiptPath), true);
  assert.equal(receipt.offer_status, "awaiting-accept");

  const accepted = await acceptBeamOffer(rendezvousDir, offerId, beamCode, {
    acceptedAt: new Date("2026-04-17T07:02:00.000Z"),
    receiverLabel: "per",
  });
  assert.equal(accepted.bundle.transfer.status, "accepted");
  assert.equal(accepted.receipt.offer_status, "accepted");
  assert.equal(accepted.receipt.receiver_label, "per");

  const inspected = inspectBeamOffer(rendezvousDir, offerId);
  assert.equal(inspected.receipt.offer_id, offerId);
  assert.equal(inspected.bundle.transfer.status, "accepted");

  const received = await receiveBeamOffer(rendezvousDir, offerId, beamCode, recvDir, {
    deleteBundleOnConsume: false,
    now: new Date("2026-04-17T07:03:00.000Z"),
  });
  assert.equal(fs.readFileSync(received.outPath, "utf-8"), "beam rendezvous payload\n");
  assert.equal(received.bundle.transfer.status, "consumed");
  assert.equal(received.receipt.offer_status, "consumed");
  assert.equal(received.receipt.handshake.status, "completed");
});

test("renderOfferSummary exposes readable PAKE fields", () => {
  const summary = renderOfferSummary({
    schema: "claw-beam.bundle.v3",
    beam_code_hint: "7-neon-****",
    created_at: "2026-04-17T06:50:00.000Z",
    expires_at: "2026-04-17T07:05:00.000Z",
    transfer: {
      status: "accepted",
      accepted_at: "2026-04-17T06:52:00.000Z",
      receiver_label: "per",
    },
    session: {
      pake_suite: "ED25519-SHA256-HKDF-HMAC-SCRYPT",
      key_wrap_stage: "pake-accepted-session",
    },
    handshake: {
      status: "receiver-accepted",
      transcript_hash: "abc123",
    },
    consumed_at: null,
    file: {
      name: "artifact.txt",
      size_bytes: 42,
      sha256: "abc123",
    },
    payload: {
      algorithm: "aes-256-gcm",
    },
    security: {
      prototype_only: true,
      encrypted_payload: true,
      pake_enabled: true,
      raw_code_stored_in_bundle: false,
    },
  });

  assert.match(summary, /schema: claw-beam.bundle.v3/);
  assert.match(summary, /beam code hint: 7-neon-\*\*\*\*/);
  assert.match(summary, /transfer_status: accepted/);
  assert.match(summary, /accepted_at: 2026-04-17T06:52:00.000Z/);
  assert.match(summary, /receiver_label: per/);
  assert.match(summary, /pake_suite: ED25519-SHA256-HKDF-HMAC-SCRYPT/);
  assert.match(summary, /key_wrap_stage: pake-accepted-session/);
  assert.match(summary, /handshake_status: receiver-accepted/);
  assert.match(summary, /transcript_hash: abc123/);
  assert.match(summary, /consumed_at: not-consumed/);
  assert.match(summary, /encrypted_payload: true/);
  assert.match(summary, /pake_enabled: true/);
  assert.match(summary, /raw_code_stored_in_bundle: false/);
  assert.match(summary, /algorithm: aes-256-gcm/);
});

test("renderRendezvousSummary exposes readable offer fields", () => {
  const summary = renderRendezvousSummary({
    schema: "claw-beam.rendezvous.v1",
    offer_id: "abc123",
    published_at: "2026-04-17T07:01:00.000Z",
    offer_status: "accepted",
    accepted_at: "2026-04-17T07:02:00.000Z",
    receiver_label: "per",
    beam_code_hint: "7-neon-****",
    file: {
      name: "artifact.txt",
      size_bytes: 42,
    },
    handshake: {
      status: "receiver-accepted",
      transcript_hash: "abc123",
    },
    bundle_path: "/tmp/mailbox/offers/abc123.beam.json",
  });

  assert.match(summary, /schema: claw-beam.rendezvous.v1/);
  assert.match(summary, /offer_id: abc123/);
  assert.match(summary, /offer_status: accepted/);
  assert.match(summary, /receiver_label: per/);
  assert.match(summary, /handshake_status: receiver-accepted/);
  assert.match(summary, /bundle_path: \/tmp\/mailbox\/offers\/abc123.beam.json/);
});
