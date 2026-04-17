import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FORMAT_VERSION = "claw-beam.bundle.v2";
const CODE_TTL_MS = 15 * 60 * 1000;
const SESSION_INFO = Buffer.from("claw-beam-session-wrap", "utf-8");

export function generateBeamCode() {
  const left = crypto.randomInt(1, 100);
  const wordsA = ["neon", "ember", "nova", "signal", "rift", "echo", "lumen", "comet"];
  const wordsB = ["comet", "anchor", "falcon", "lantern", "vector", "orbit", "spark", "harbor"];
  return `${left}-${wordsA[crypto.randomInt(0, wordsA.length)]}-${wordsB[crypto.randomInt(0, wordsB.length)]}`;
}

export function generateNonce() {
  return crypto.randomBytes(16).toString("base64");
}

export function maskBeamCode(code) {
  const [part1 = "??", part2 = "hidden"] = String(code).split("-");
  return `${part1}-${part2}-****`;
}

export function deriveBootstrapKey(code, senderNonce) {
  return crypto.scryptSync(code, Buffer.from(senderNonce, "base64"), 32);
}

export function deriveSessionWrapKey(code, senderNonce, acceptNonce) {
  const bootstrapKey = deriveBootstrapKey(code, senderNonce);
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      bootstrapKey,
      Buffer.from(acceptNonce, "base64"),
      SESSION_INFO,
      32,
    ),
  );
}

export function encryptBufferWithKey(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function decryptBufferWithKey(payload, key) {
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
  const senderNonce = generateNonce();
  const payloadKey = crypto.randomBytes(32);
  const bootstrapKey = deriveBootstrapKey(beamCode, senderNonce);
  const fileBytes = fs.readFileSync(resolved);
  const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  const payload = encryptBufferWithKey(fileBytes, payloadKey);
  const keyWrap = encryptBufferWithKey(payloadKey, bootstrapKey);

  const bundle = {
    schema: FORMAT_VERSION,
    created_at: now.toISOString(),
    expires_at: expiresAt,
    beam_code_hint: maskBeamCode(beamCode),
    transfer: {
      status: "awaiting-accept",
      accepted_at: null,
      receiver_label: null,
    },
    session: {
      sender_nonce: senderNonce,
      accept_nonce: null,
      key_wrap_stage: "bootstrap",
    },
    consumed_at: null,
    file: {
      name: basename,
      size_bytes: stat.size,
      sha256,
    },
    payload,
    key_wrap: keyWrap,
    security: {
      prototype_only: true,
      encrypted_payload: true,
      raw_code_stored_in_bundle: false,
      notes: "Local encrypted POC. Bundle stores only a masked code hint and session-wrapped payload key.",
    },
  };

  return { bundle, beamCode };
}

export function writeBeamBundle(filePath, outDir = ".out", now = new Date()) {
  const { bundle, beamCode } = createBeamBundle(filePath, now);
  const resolvedOutDir = path.resolve(outDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const bundlePath = path.join(resolvedOutDir, `${path.basename(filePath)}.beam.json`);
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n", "utf-8");
  return { bundle, bundlePath, beamCode };
}

function loadBundle(bundlePath) {
  return JSON.parse(fs.readFileSync(path.resolve(bundlePath), "utf-8"));
}

function saveBundle(bundlePath, bundle) {
  fs.writeFileSync(path.resolve(bundlePath), JSON.stringify(bundle, null, 2) + "\n", "utf-8");
}

function unwrapPayloadKeyFromBootstrap(bundle, code) {
  const bootstrapKey = deriveBootstrapKey(code, bundle.session.sender_nonce);
  return decryptBufferWithKey(bundle.key_wrap, bootstrapKey);
}

function unwrapPayloadKeyFromAcceptedSession(bundle, code) {
  const sessionKey = deriveSessionWrapKey(code, bundle.session.sender_nonce, bundle.session.accept_nonce);
  return decryptBufferWithKey(bundle.key_wrap, sessionKey);
}

export function acceptBeamBundle(bundlePath, code, options = {}) {
  const { acceptedAt = new Date(), receiverLabel = "receiver" } = options;
  const bundle = loadBundle(bundlePath);
  if (bundle.schema !== FORMAT_VERSION) {
    throw new Error(`Unsupported bundle schema: ${bundle.schema}`);
  }
  if (bundle.consumed_at) {
    throw new Error("Cannot accept a consumed beam bundle.");
  }
  if (new Date(bundle.expires_at).getTime() < acceptedAt.getTime()) {
    throw new Error("Beam code expired.");
  }
  if (bundle.transfer?.status === "accepted") {
    throw new Error("Beam bundle already accepted.");
  }

  const payloadKey = unwrapPayloadKeyFromBootstrap(bundle, code);
  const acceptNonce = generateNonce();
  const sessionKey = deriveSessionWrapKey(code, bundle.session.sender_nonce, acceptNonce);
  bundle.key_wrap = encryptBufferWithKey(payloadKey, sessionKey);
  bundle.transfer = bundle.transfer ?? {};
  bundle.transfer.status = "accepted";
  bundle.transfer.accepted_at = acceptedAt.toISOString();
  bundle.transfer.receiver_label = receiverLabel;
  bundle.session = bundle.session ?? {};
  bundle.session.accept_nonce = acceptNonce;
  bundle.session.key_wrap_stage = "accepted-session";
  saveBundle(bundlePath, bundle);
  return bundle;
}

export function markBundleConsumed(bundlePath, consumedAt = new Date()) {
  const bundle = loadBundle(bundlePath);
  bundle.consumed_at = consumedAt.toISOString();
  bundle.transfer = bundle.transfer ?? {};
  bundle.transfer.status = "consumed";
  saveBundle(bundlePath, bundle);
  return bundle;
}

export function receiveBeamBundle(bundlePath, code, outputDir = ".out", options = {}) {
  const { consume = true, deleteBundleOnConsume = true, now = new Date() } = options;
  const resolvedBundlePath = path.resolve(bundlePath);
  const bundle = loadBundle(resolvedBundlePath);
  if (bundle.schema !== FORMAT_VERSION) {
    throw new Error(`Unsupported bundle schema: ${bundle.schema}`);
  }
  if (bundle.consumed_at) {
    throw new Error("Beam bundle already consumed.");
  }
  if (new Date(bundle.expires_at).getTime() < now.getTime()) {
    throw new Error("Beam code expired.");
  }
  if (!bundle.transfer || bundle.transfer.status !== "accepted" || !bundle.transfer.accepted_at) {
    throw new Error("Beam bundle must be accepted before receive.");
  }
  if (!bundle.session || bundle.session.key_wrap_stage !== "accepted-session" || !bundle.session.accept_nonce) {
    throw new Error("Beam session is incomplete.");
  }

  const payloadKey = unwrapPayloadKeyFromAcceptedSession(bundle, code);
  const plaintext = decryptBufferWithKey(bundle.payload, payloadKey);
  const actualSha = crypto.createHash("sha256").update(plaintext).digest("hex");
  if (actualSha !== bundle.file.sha256) {
    throw new Error("Integrity check failed after decryption.");
  }

  const resolvedOutDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const outPath = path.join(resolvedOutDir, bundle.file.name);
  fs.writeFileSync(outPath, plaintext);

  let updatedBundle = bundle;
  if (consume) {
    updatedBundle = markBundleConsumed(resolvedBundlePath, now);
    if (deleteBundleOnConsume) {
      fs.unlinkSync(resolvedBundlePath);
    }
  }

  return { bundle: updatedBundle, outPath };
}

export function renderOfferSummary(bundle) {
  return [
    `schema: ${bundle.schema}`,
    `beam code hint: ${bundle.beam_code_hint ?? "not-available"}`,
    `created: ${bundle.created_at}`,
    `expires: ${bundle.expires_at}`,
    `transfer_status: ${bundle.transfer?.status ?? "unknown"}`,
    `accepted_at: ${bundle.transfer?.accepted_at ?? "not-accepted"}`,
    `receiver_label: ${bundle.transfer?.receiver_label ?? "not-set"}`,
    `key_wrap_stage: ${bundle.session?.key_wrap_stage ?? "unknown"}`,
    `consumed_at: ${bundle.consumed_at ?? "not-consumed"}`,
    `file: ${bundle.file.name}`,
    `size_bytes: ${bundle.file.size_bytes}`,
    `sha256: ${bundle.file.sha256}`,
    `prototype_only: ${bundle.security.prototype_only}`,
    `encrypted_payload: ${bundle.security.encrypted_payload}`,
    `raw_code_stored_in_bundle: ${bundle.security.raw_code_stored_in_bundle}`,
    `algorithm: ${bundle.payload?.algorithm ?? "metadata-only"}`,
  ].join("\n");
}
