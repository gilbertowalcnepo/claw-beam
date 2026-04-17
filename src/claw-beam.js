import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FORMAT_VERSION = "claw-beam.bundle.v1";
const CODE_TTL_MS = 15 * 60 * 1000;

export function generateBeamCode() {
  const left = crypto.randomInt(1, 100);
  const wordsA = ["neon", "ember", "nova", "signal", "rift", "echo", "lumen", "comet"];
  const wordsB = ["comet", "anchor", "falcon", "lantern", "vector", "orbit", "spark", "harbor"];
  return `${left}-${wordsA[crypto.randomInt(0, wordsA.length)]}-${wordsB[crypto.randomInt(0, wordsB.length)]}`;
}

export function deriveBundleKey(code, salt) {
  return crypto.scryptSync(code, salt, 32);
}

export function encryptBufferWithCode(buffer, code) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveBundleKey(code, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { salt, iv, encrypted, tag };
}

export function decryptBufferWithCode(payload, code) {
  const key = deriveBundleKey(code, Buffer.from(payload.salt, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
}

export function createBeamBundle(filePath, now = new Date()) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const basename = path.basename(resolved);
  const beamCode = generateBeamCode();
  const fileBytes = fs.readFileSync(resolved);
  const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  const encrypted = encryptBufferWithCode(fileBytes, beamCode);

  return {
    schema: FORMAT_VERSION,
    created_at: now.toISOString(),
    expires_at: expiresAt,
    beam_code: beamCode,
    file: {
      name: basename,
      size_bytes: stat.size,
      sha256,
    },
    payload: {
      algorithm: "aes-256-gcm+scrypt",
      salt: encrypted.salt.toString("base64"),
      iv: encrypted.iv.toString("base64"),
      tag: encrypted.tag.toString("base64"),
      ciphertext: encrypted.encrypted.toString("base64"),
    },
    security: {
      prototype_only: true,
      encrypted_payload: true,
      notes: "Local encrypted POC. Suitable for prototype evaluation only, not final protocol claims.",
    },
  };
}

export function writeBeamBundle(filePath, outDir = ".out", now = new Date()) {
  const bundle = createBeamBundle(filePath, now);
  const resolvedOutDir = path.resolve(outDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const bundlePath = path.join(resolvedOutDir, `${path.basename(filePath)}.beam.json`);
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n", "utf-8");
  return { bundle, bundlePath };
}

export function receiveBeamBundle(bundlePath, code, outputDir = ".out") {
  const resolvedBundlePath = path.resolve(bundlePath);
  const bundle = JSON.parse(fs.readFileSync(resolvedBundlePath, "utf-8"));
  if (bundle.schema !== FORMAT_VERSION) {
    throw new Error(`Unsupported bundle schema: ${bundle.schema}`);
  }
  if (new Date(bundle.expires_at).getTime() < Date.now()) {
    throw new Error("Beam code expired.");
  }

  const plaintext = decryptBufferWithCode(bundle.payload, code);
  const actualSha = crypto.createHash("sha256").update(plaintext).digest("hex");
  if (actualSha !== bundle.file.sha256) {
    throw new Error("Integrity check failed after decryption.");
  }

  const resolvedOutDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const outPath = path.join(resolvedOutDir, bundle.file.name);
  fs.writeFileSync(outPath, plaintext);
  return { bundle, outPath };
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
    `algorithm: ${offer.payload?.algorithm ?? "metadata-only"}`,
  ].join("\n");
}
