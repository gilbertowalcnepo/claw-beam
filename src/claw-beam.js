import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { spake2 } = require("spake2");

const FORMAT_VERSION = "claw-beam.bundle.v3";
const RENDEZVOUS_VERSION = "claw-beam.rendezvous.v1";
const CODE_TTL_MS = 15 * 60 * 1000;
const SESSION_INFO = Buffer.from("claw-beam-session-wrap", "utf-8");
const PAKE_WRAP_INFO = Buffer.from("claw-beam-pake-wrap", "utf-8");
const PAKE_VERIFIER_WRAP_INFO = Buffer.from("claw-beam-pake-verifier-wrap", "utf-8");
const PAKE_KDF_AAD = "claw-beam-pake-v1";
const PAKE_MHF = { n: 16, r: 1, p: 1 };
const PAKE_SALT_BYTES = 16;
const PAKE_SUITE = "ED25519-SHA256-HKDF-HMAC-SCRYPT";
const SENDER_IDENTITY = "claw-beam-sender";
const RECEIVER_IDENTITY = "claw-beam-receiver";

export function generateBeamCode() {
  const left = crypto.randomInt(1, 100);
  const wordsA = ["neon", "ember", "nova", "signal", "rift", "echo", "lumen", "comet"];
  const wordsB = ["comet", "anchor", "falcon", "lantern", "vector", "orbit", "spark", "harbor"];
  return `${left}-${wordsA[crypto.randomInt(0, wordsA.length)]}-${wordsB[crypto.randomInt(0, wordsB.length)]}`;
}

export function generateNonce() {
  return crypto.randomBytes(16).toString("base64");
}

function generateSalt() {
  return crypto.randomBytes(PAKE_SALT_BYTES).toString("base64");
}

export function maskBeamCode(code) {
  const [part1 = "??", part2 = "hidden"] = String(code).split("-");
  return `${part1}-${part2}-****`;
}

function createSpakeInstance() {
  return spake2({
    suite: PAKE_SUITE,
    mhf: PAKE_MHF,
    kdf: { AAD: PAKE_KDF_AAD },
  });
}

async function derivePakeArtifacts(code, saltBase64) {
  const salt = Buffer.from(saltBase64, "base64");
  const instance = createSpakeInstance();
  const verifier = await instance.computeVerifier(code, salt, SENDER_IDENTITY, RECEIVER_IDENTITY);
  const clientState = await instance.startClient(SENDER_IDENTITY, RECEIVER_IDENTITY, code, salt);
  const serverState = await instance.startServer(SENDER_IDENTITY, RECEIVER_IDENTITY, verifier);

  const messageA = clientState.getMessage();
  const messageB = serverState.getMessage();
  const clientShared = clientState.finish(messageB);
  const serverShared = serverState.finish(messageA);
  const confirmationA = clientShared.getConfirmation();
  serverShared.verify(confirmationA);
  const confirmationB = serverShared.getConfirmation();
  clientShared.verify(confirmationB);

  return {
    verifier: Buffer.from(verifier),
    messageA: Buffer.from(messageA),
    messageB: Buffer.from(messageB),
    confirmationA: Buffer.from(confirmationA),
    confirmationB: Buffer.from(confirmationB),
    sharedKey: Buffer.from(clientShared.toBuffer()),
    transcript: Buffer.from(clientShared.transcript),
    transcriptHash: crypto.createHash("sha256").update(clientShared.transcript).digest("hex"),
  };
}

async function derivePakeVerifier(code, saltBase64) {
  const salt = Buffer.from(saltBase64, "base64");
  const instance = createSpakeInstance();
  return Buffer.from(await instance.computeVerifier(code, salt, SENDER_IDENTITY, RECEIVER_IDENTITY));
}

function derivePakeWrapKey(sharedKey, saltBuffer = Buffer.alloc(0)) {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      sharedKey,
      saltBuffer,
      PAKE_WRAP_INFO,
      32,
    ),
  );
}

function deriveVerifierWrapKey(verifier, saltBuffer = Buffer.alloc(0)) {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      verifier,
      saltBuffer,
      PAKE_VERIFIER_WRAP_INFO,
      32,
    ),
  );
}

async function deriveSessionWrapKey(code, saltBase64, acceptNonceBase64) {
  const verifier = await derivePakeVerifier(code, saltBase64);
  const verifierWrapKey = deriveVerifierWrapKey(verifier, Buffer.from(saltBase64, "base64"));
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      verifierWrapKey,
      Buffer.from(acceptNonceBase64, "base64"),
      SESSION_INFO,
      32,
    ),
  );
}

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildTranscriptHash(bundle) {
  return hashObject({
    schema: bundle.schema,
    beam_code_hint: bundle.beam_code_hint,
    transfer: bundle.transfer,
    session: {
      pake_salt: bundle.session?.pake_salt ?? null,
      accept_nonce: bundle.session?.accept_nonce ?? null,
      key_wrap_stage: bundle.session?.key_wrap_stage ?? null,
      pake_suite: bundle.session?.pake_suite ?? null,
    },
    handshake: {
      status: bundle.handshake?.status ?? null,
      transcript_hash: bundle.handshake?.transcript_hash ?? null,
      verifier: bundle.handshake?.verifier ?? null,
      sender_message: bundle.handshake?.sender_message ?? null,
      receiver_message: bundle.handshake?.receiver_message ?? null,
      sender_confirmation: bundle.handshake?.sender_confirmation ?? null,
      receiver_confirmation: bundle.handshake?.receiver_confirmation ?? null,
    },
    file: bundle.file,
  });
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

export async function createBeamBundle(filePath, now = new Date()) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const basename = path.basename(resolved);
  const beamCode = generateBeamCode();
  const pakeSalt = generateSalt();
  const payloadKey = crypto.randomBytes(32);
  const fileBytes = fs.readFileSync(resolved);
  const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  const pakeArtifacts = await derivePakeArtifacts(beamCode, pakeSalt);

  const payload = encryptBufferWithKey(fileBytes, payloadKey);
  const pakeWrapKey = derivePakeWrapKey(pakeArtifacts.sharedKey, Buffer.from(pakeSalt, "base64"));
  const verifierWrapKey = deriveVerifierWrapKey(pakeArtifacts.verifier, Buffer.from(pakeSalt, "base64"));
  const keyWrap = encryptBufferWithKey(payloadKey, pakeWrapKey);
  const pakeSharedSecretWrap = encryptBufferWithKey(pakeArtifacts.sharedKey, verifierWrapKey);

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
      pake_salt: pakeSalt,
      pake_suite: PAKE_SUITE,
      accept_nonce: null,
      key_wrap_stage: "pake-bootstrap",
    },
    handshake: {
      status: "sender-prepared",
      verifier: pakeArtifacts.verifier.toString("base64"),
      sender_message: pakeArtifacts.messageA.toString("base64"),
      receiver_message: pakeArtifacts.messageB.toString("base64"),
      sender_confirmation: pakeArtifacts.confirmationA.toString("base64"),
      receiver_confirmation: pakeArtifacts.confirmationB.toString("base64"),
      transcript_hash: pakeArtifacts.transcriptHash,
    },
    consumed_at: null,
    file: {
      name: basename,
      size_bytes: stat.size,
      sha256,
    },
    payload,
    key_wrap: keyWrap,
    pake_shared_secret_wrap: pakeSharedSecretWrap,
    security: {
      prototype_only: true,
      encrypted_payload: true,
      raw_code_stored_in_bundle: false,
      pake_enabled: true,
      notes: "Local encrypted POC. Bundle stores only a masked code hint and PAKE-derived wrapped payload key.",
    },
  };

  bundle.handshake.bundle_hash = buildTranscriptHash(bundle);

  return { bundle, beamCode };
}

export async function writeBeamBundle(filePath, outDir = ".out", now = new Date()) {
  const { bundle, beamCode } = await createBeamBundle(filePath, now);
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

function bundleStatePatch(bundle) {
  return {
    transfer: {
      status: bundle.transfer?.status ?? null,
      accepted_at: bundle.transfer?.accepted_at ?? null,
      receiver_label: bundle.transfer?.receiver_label ?? null,
    },
    session: {
      accept_nonce: bundle.session?.accept_nonce ?? null,
      key_wrap_stage: bundle.session?.key_wrap_stage ?? null,
    },
    key_wrap: bundle.key_wrap ?? null,
    handshake: {
      status: bundle.handshake?.status ?? null,
      transcript_hash: bundle.handshake?.transcript_hash ?? null,
      bundle_hash: bundle.handshake?.bundle_hash ?? null,
    },
    consumed_at: bundle.consumed_at ?? null,
  };
}

function requestJson(method, targetUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === "https:" ? https : http;
    const payload = body == null ? null : JSON.stringify(body);
    const req = transport.request({
      method,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      headers: payload
        ? {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          }
        : undefined,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        const parsedBody = raw ? JSON.parse(raw) : {};
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(parsedBody.error || `HTTP ${res.statusCode}`));
          return;
        }
        resolve(parsedBody);
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function ensureRendezvousDirs(rendezvousDir) {
  const resolved = path.resolve(rendezvousDir);
  fs.mkdirSync(path.join(resolved, "offers"), { recursive: true });
  fs.mkdirSync(path.join(resolved, "receipts"), { recursive: true });
  return resolved;
}

function generateOfferId() {
  return crypto.randomBytes(8).toString("hex");
}

function getOfferBundlePath(rendezvousDir, offerId) {
  return path.join(path.resolve(rendezvousDir), "offers", `${offerId}.beam.json`);
}

function getOfferReceiptPath(rendezvousDir, offerId) {
  return path.join(path.resolve(rendezvousDir), "receipts", `${offerId}.json`);
}

export function loadRendezvousReceipt(rendezvousDir, offerId) {
  return JSON.parse(fs.readFileSync(getOfferReceiptPath(rendezvousDir, offerId), "utf-8"));
}

async function recoverPakeSharedKey(bundle, code) {
  const verifier = await derivePakeVerifier(code, bundle.session.pake_salt);
  if (verifier.toString("base64") !== bundle.handshake.verifier) {
    throw new Error("PAKE verifier mismatch.");
  }
  const verifierWrapKey = deriveVerifierWrapKey(verifier, Buffer.from(bundle.session.pake_salt, "base64"));
  return decryptBufferWithKey(bundle.pake_shared_secret_wrap, verifierWrapKey);
}

async function unwrapPayloadKeyFromPake(bundle, code) {
  const sharedKey = await recoverPakeSharedKey(bundle, code);
  const pakeWrapKey = derivePakeWrapKey(sharedKey, Buffer.from(bundle.session.pake_salt, "base64"));
  return decryptBufferWithKey(bundle.key_wrap, pakeWrapKey);
}

async function unwrapPayloadKeyFromAcceptedSession(bundle, code) {
  await recoverPakeSharedKey(bundle, code);
  const sessionKey = await deriveSessionWrapKey(code, bundle.session.pake_salt, bundle.session.accept_nonce);
  return decryptBufferWithKey(bundle.key_wrap, sessionKey);
}

export async function acceptBeamBundle(bundlePath, code, options = {}) {
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

  const payloadKey = await unwrapPayloadKeyFromPake(bundle, code);
  const acceptNonce = generateNonce();
  const sessionKey = await deriveSessionWrapKey(code, bundle.session.pake_salt, acceptNonce);
  bundle.key_wrap = encryptBufferWithKey(payloadKey, sessionKey);
  bundle.transfer = bundle.transfer ?? {};
  bundle.transfer.status = "accepted";
  bundle.transfer.accepted_at = acceptedAt.toISOString();
  bundle.transfer.receiver_label = receiverLabel;
  bundle.session = bundle.session ?? {};
  bundle.session.accept_nonce = acceptNonce;
  bundle.session.key_wrap_stage = "pake-accepted-session";
  bundle.handshake = bundle.handshake ?? {};
  bundle.handshake.status = "receiver-accepted";
  bundle.handshake.bundle_hash = buildTranscriptHash(bundle);
  saveBundle(bundlePath, bundle);
  return bundle;
}

export async function publishBeamBundleToRendezvous(bundlePath, rendezvousDir, options = {}) {
  const { offerId = generateOfferId(), publishedAt = new Date() } = options;
  const bundle = loadBundle(bundlePath);
  const resolvedDir = ensureRendezvousDirs(rendezvousDir);
  const offerPath = getOfferBundlePath(resolvedDir, offerId);
  const receiptPath = getOfferReceiptPath(resolvedDir, offerId);

  const envelope = {
    schema: RENDEZVOUS_VERSION,
    offer_id: offerId,
    published_at: publishedAt.toISOString(),
    offer_status: bundle.transfer?.status ?? "awaiting-accept",
    bundle_path: offerPath,
    beam_code_hint: bundle.beam_code_hint,
    file: bundle.file,
    transfer: bundle.transfer,
    handshake: {
      status: bundle.handshake?.status ?? null,
      transcript_hash: bundle.handshake?.transcript_hash ?? null,
    },
  };

  fs.copyFileSync(path.resolve(bundlePath), offerPath);
  fs.writeFileSync(receiptPath, JSON.stringify(envelope, null, 2) + "\n", "utf-8");
  return { offerId, offerPath, receiptPath, receipt: envelope };
}

export function inspectBeamOffer(rendezvousDir, offerId) {
  const bundle = loadBundle(getOfferBundlePath(rendezvousDir, offerId));
  const receipt = loadRendezvousReceipt(rendezvousDir, offerId);
  return { bundle, receipt };
}

export async function publishBeamBundleToHttpRendezvous(bundlePath, baseUrl, options = {}) {
  const { offerId, publishedAt = new Date() } = options;
  const bundle = loadBundle(bundlePath);
  const response = await requestJson("POST", `${baseUrl.replace(/\/$/, "")}/offers`, {
    offer_id: offerId,
    published_at: publishedAt.toISOString(),
    bundle,
  });
  return { offerId: response.offer_id, receipt: response.receipt, bundle };
}

export async function inspectBeamOfferHttp(baseUrl, offerId) {
  const response = await requestJson("GET", `${baseUrl.replace(/\/$/, "")}/offers/${offerId}`);
  return { receipt: response.receipt, bundle: response.bundle, state: response.state };
}

export async function inspectBeamHandshakeHttp(baseUrl, offerId) {
  return requestJson("GET", `${baseUrl.replace(/\/$/, "")}/offers/${offerId}/handshake`);
}

export async function postBeamHandshakeHttp(baseUrl, offerId, eventType, payload = {}, handshake = {}) {
  return requestJson("POST", `${baseUrl.replace(/\/$/, "")}/offers/${offerId}/handshake`, {
    event_type: eventType,
    payload,
    handshake,
  });
}

export async function acceptBeamOffer(rendezvousDir, offerId, code, options = {}) {
  const { acceptedAt = new Date(), receiverLabel = "receiver" } = options;
  const offerPath = getOfferBundlePath(rendezvousDir, offerId);
  const acceptedBundle = await acceptBeamBundle(offerPath, code, { acceptedAt, receiverLabel });
  const receiptPath = getOfferReceiptPath(rendezvousDir, offerId);
  const receipt = loadRendezvousReceipt(rendezvousDir, offerId);
  receipt.offer_status = acceptedBundle.transfer?.status ?? "accepted";
  receipt.accepted_at = acceptedBundle.transfer?.accepted_at ?? acceptedAt.toISOString();
  receipt.receiver_label = acceptedBundle.transfer?.receiver_label ?? receiverLabel;
  receipt.handshake = {
    status: acceptedBundle.handshake?.status ?? null,
    transcript_hash: acceptedBundle.handshake?.transcript_hash ?? null,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf-8");
  return { bundle: acceptedBundle, receipt };
}

export async function acceptBeamOfferHttp(baseUrl, offerId, code, options = {}) {
  const { acceptedAt = new Date(), receiverLabel = "receiver" } = options;
  const inspected = await inspectBeamOfferHttp(baseUrl, offerId);
  await postBeamHandshakeHttp(baseUrl, offerId, "receiver-accept-started", {
    receiver_label: receiverLabel,
    prior_handshake_status: inspected.bundle.handshake?.status ?? null,
  }, {
    status: inspected.bundle.handshake?.status ?? null,
    transcript_hash: inspected.bundle.handshake?.transcript_hash ?? null,
    bundle_hash: inspected.bundle.handshake?.bundle_hash ?? null,
  });
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-claw-beam-http-"));
  const tempBundlePath = path.join(tempDir, `${offerId}.beam.json`);
  fs.writeFileSync(tempBundlePath, JSON.stringify(inspected.bundle, null, 2) + "\n", "utf-8");
  const bundle = await acceptBeamBundle(tempBundlePath, code, { acceptedAt, receiverLabel });
  await postBeamHandshakeHttp(baseUrl, offerId, "receiver-accepted", {
    receiver_label: receiverLabel,
    accept_nonce: bundle.session?.accept_nonce ?? null,
    key_wrap_stage: bundle.session?.key_wrap_stage ?? null,
  }, {
    status: bundle.handshake?.status ?? null,
    transcript_hash: bundle.handshake?.transcript_hash ?? null,
    bundle_hash: bundle.handshake?.bundle_hash ?? null,
  });
  await requestJson("POST", `${baseUrl.replace(/\/$/, "")}/offers/${offerId}/accept`, {
    offer_status: bundle.transfer?.status,
    accepted_at: bundle.transfer?.accepted_at,
    receiver_label: bundle.transfer?.receiver_label,
    ...bundleStatePatch(bundle),
  });
  return { bundle, receipt: (await inspectBeamOfferHttp(baseUrl, offerId)).receipt };
}

export function markBundleConsumed(bundlePath, consumedAt = new Date()) {
  const bundle = loadBundle(bundlePath);
  bundle.consumed_at = consumedAt.toISOString();
  bundle.transfer = bundle.transfer ?? {};
  bundle.transfer.status = "consumed";
  bundle.handshake = bundle.handshake ?? {};
  bundle.handshake.status = "completed";
  bundle.handshake.bundle_hash = buildTranscriptHash(bundle);
  saveBundle(bundlePath, bundle);
  return bundle;
}

export async function receiveBeamBundle(bundlePath, code, outputDir = ".out", options = {}) {
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
  if (!bundle.session || bundle.session.key_wrap_stage !== "pake-accepted-session" || !bundle.session.accept_nonce) {
    throw new Error("Beam session is incomplete.");
  }
  if (!bundle.handshake || bundle.handshake.status !== "receiver-accepted" || !bundle.handshake.transcript_hash) {
    throw new Error("Beam handshake is incomplete.");
  }

  const payloadKey = await unwrapPayloadKeyFromAcceptedSession(bundle, code);
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

export async function receiveBeamOffer(rendezvousDir, offerId, code, outputDir = ".out", options = {}) {
  const { bundle, outPath } = await receiveBeamBundle(getOfferBundlePath(rendezvousDir, offerId), code, outputDir, options);
  const receiptPath = getOfferReceiptPath(rendezvousDir, offerId);
  const receipt = loadRendezvousReceipt(rendezvousDir, offerId);
  receipt.offer_status = bundle.transfer?.status ?? "consumed";
  receipt.consumed_at = bundle.consumed_at ?? new Date().toISOString();
  receipt.handshake = {
    status: bundle.handshake?.status ?? null,
    transcript_hash: bundle.handshake?.transcript_hash ?? null,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf-8");
  return { bundle, outPath, receipt };
}

export async function receiveBeamOfferHttp(baseUrl, offerId, code, outputDir = ".out", options = {}) {
  const inspected = await inspectBeamOfferHttp(baseUrl, offerId);
  await postBeamHandshakeHttp(baseUrl, offerId, "receiver-consume-started", {
    transfer_status: inspected.bundle.transfer?.status ?? null,
    handshake_status: inspected.bundle.handshake?.status ?? null,
  }, {
    status: inspected.bundle.handshake?.status ?? null,
    transcript_hash: inspected.bundle.handshake?.transcript_hash ?? null,
    bundle_hash: inspected.bundle.handshake?.bundle_hash ?? null,
  });
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-claw-beam-http-"));
  const tempBundlePath = path.join(tempDir, `${offerId}.beam.json`);
  fs.writeFileSync(tempBundlePath, JSON.stringify(inspected.bundle, null, 2) + "\n", "utf-8");
  const { bundle, outPath } = await receiveBeamBundle(tempBundlePath, code, outputDir, options);
  await postBeamHandshakeHttp(baseUrl, offerId, "receiver-consumed", {
    consumed_at: bundle.consumed_at ?? null,
    transfer_status: bundle.transfer?.status ?? null,
  }, {
    status: bundle.handshake?.status ?? null,
    transcript_hash: bundle.handshake?.transcript_hash ?? null,
    bundle_hash: bundle.handshake?.bundle_hash ?? null,
  });
  await requestJson("POST", `${baseUrl.replace(/\/$/, "")}/offers/${offerId}/consume`, {
    offer_status: bundle.transfer?.status,
    consumed_at: bundle.consumed_at,
    ...bundleStatePatch(bundle),
  });
  return { bundle, outPath, receipt: (await inspectBeamOfferHttp(baseUrl, offerId)).receipt };
}

export function renderRendezvousSummary(receipt) {
  return [
    `schema: ${receipt.schema}`,
    `offer_id: ${receipt.offer_id}`,
    `published_at: ${receipt.published_at}`,
    `offer_status: ${receipt.offer_status}`,
    `accepted_at: ${receipt.accepted_at ?? "not-accepted"}`,
    `receiver_label: ${receipt.receiver_label ?? "not-set"}`,
    `beam_code_hint: ${receipt.beam_code_hint ?? "not-available"}`,
    `file: ${receipt.file?.name ?? "unknown"}`,
    `size_bytes: ${receipt.file?.size_bytes ?? "unknown"}`,
    `handshake_status: ${receipt.handshake?.status ?? "unknown"}`,
    `transcript_hash: ${receipt.handshake?.transcript_hash ?? "missing"}`,
    `bundle_path: ${receipt.bundle_path}`,
  ].join("\n");
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
    `pake_suite: ${bundle.session?.pake_suite ?? "unknown"}`,
    `key_wrap_stage: ${bundle.session?.key_wrap_stage ?? "unknown"}`,
    `handshake_status: ${bundle.handshake?.status ?? "unknown"}`,
    `transcript_hash: ${bundle.handshake?.transcript_hash ?? "missing"}`,
    `consumed_at: ${bundle.consumed_at ?? "not-consumed"}`,
    `file: ${bundle.file.name}`,
    `size_bytes: ${bundle.file.size_bytes}`,
    `sha256: ${bundle.file.sha256}`,
    `prototype_only: ${bundle.security.prototype_only}`,
    `encrypted_payload: ${bundle.security.encrypted_payload}`,
    `pake_enabled: ${bundle.security.pake_enabled}`,
    `raw_code_stored_in_bundle: ${bundle.security.raw_code_stored_in_bundle}`,
    `algorithm: ${bundle.payload?.algorithm ?? "metadata-only"}`,
  ].join("\n");
}
