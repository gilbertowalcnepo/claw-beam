import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function generateBeamCode() {
  const left = crypto.randomInt(1, 100);
  const wordsA = ["neon", "ember", "nova", "signal", "rift", "echo", "lumen", "comet"];
  const wordsB = ["comet", "anchor", "falcon", "lantern", "vector", "orbit", "spark", "harbor"];
  return `${left}-${wordsA[crypto.randomInt(0, wordsA.length)]}-${wordsB[crypto.randomInt(0, wordsB.length)]}`;
}

export function createBeamOffer(filePath, now = new Date()) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const basename = path.basename(resolved);
  const beamCode = generateBeamCode();
  const fileBytes = fs.readFileSync(resolved);
  const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  return {
    schema: "claw-beam.offer.v0",
    created_at: now.toISOString(),
    expires_at: expiresAt,
    beam_code: beamCode,
    file: {
      name: basename,
      size_bytes: stat.size,
      sha256,
    },
    security: {
      prototype_only: true,
      encrypted_payload: false,
      notes: "Metadata-only prototype. Do not use for sensitive transfer.",
    },
  };
}

export function renderOfferSummary(offer) {
  return [
    `schema: ${offer.schema}`,
    `beam code: ${offer.beam_code}`,
    `created: ${offer.created_at}`,
    `expires: ${offer.expires_at}`,
    `file: ${offer.file.name}`,
    `size_bytes: ${offer.file.size_bytes}`,
    `sha256: ${offer.file.sha256}`,
    `prototype_only: ${offer.security.prototype_only}`,
    `encrypted_payload: ${offer.security.encrypted_payload}`,
  ].join("\n");
}
