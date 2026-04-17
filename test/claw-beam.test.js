import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createBeamOffer, renderOfferSummary } from "../src/claw-beam.js";

test("createBeamOffer builds prototype metadata for a file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-"));
  const filePath = path.join(tempDir, "artifact.txt");
  fs.writeFileSync(filePath, "hello beam\n", "utf-8");

  const offer = createBeamOffer(filePath, new Date("2026-04-17T06:50:00.000Z"));

  assert.equal(offer.schema, "claw-beam.offer.v0");
  assert.equal(offer.file.name, "artifact.txt");
  assert.equal(offer.file.size_bytes, Buffer.byteLength("hello beam\n"));
  assert.equal(offer.security.prototype_only, true);
  assert.equal(offer.security.encrypted_payload, false);
  assert.match(offer.beam_code, /^\d{1,2}-[a-z]+-[a-z]+$/);
});

test("renderOfferSummary exposes readable fields", () => {
  const summary = renderOfferSummary({
    schema: "claw-beam.offer.v0",
    beam_code: "7-neon-comet",
    created_at: "2026-04-17T06:50:00.000Z",
    expires_at: "2026-04-17T07:05:00.000Z",
    file: {
      name: "artifact.txt",
      size_bytes: 42,
      sha256: "abc123",
    },
    security: {
      prototype_only: true,
      encrypted_payload: false,
    },
  });

  assert.match(summary, /beam code: 7-neon-comet/);
  assert.match(summary, /file: artifact.txt/);
  assert.match(summary, /encrypted_payload: false/);
});
