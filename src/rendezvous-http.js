import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";

const SERVER_SCHEMA = "claw-beam.rendezvous.http.v1";
const RECEIPT_SCHEMA = "claw-beam.rendezvous.v1";
const STATE_SCHEMA = "claw-beam.rendezvous.state.v1";

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2) + "\n";
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function ensureStoreDirs(storeDir) {
  const resolved = path.resolve(storeDir);
  fs.mkdirSync(path.join(resolved, "offers"), { recursive: true });
  fs.mkdirSync(path.join(resolved, "receipts"), { recursive: true });
  fs.mkdirSync(path.join(resolved, "states"), { recursive: true });
  return resolved;
}

function generateOfferId() {
  return crypto.randomBytes(8).toString("hex");
}

function offerPath(storeDir, offerId) {
  return path.join(storeDir, "offers", `${offerId}.beam.json`);
}

function receiptPath(storeDir, offerId) {
  return path.join(storeDir, "receipts", `${offerId}.json`);
}

function statePath(storeDir, offerId) {
  return path.join(storeDir, "states", `${offerId}.json`);
}

function loadReceipt(storeDir, offerId) {
  return JSON.parse(fs.readFileSync(receiptPath(storeDir, offerId), "utf-8"));
}

function saveReceipt(storeDir, offerId, receipt) {
  fs.writeFileSync(receiptPath(storeDir, offerId), JSON.stringify(receipt, null, 2) + "\n", "utf-8");
}

function createInitialState(offerId, bundle) {
  return {
    schema: STATE_SCHEMA,
    offer_id: offerId,
    transfer: {
      status: bundle.transfer?.status ?? "awaiting-accept",
      accepted_at: bundle.transfer?.accepted_at ?? null,
      receiver_label: bundle.transfer?.receiver_label ?? null,
    },
    session: {
      accept_nonce: bundle.session?.accept_nonce ?? null,
      key_wrap_stage: bundle.session?.key_wrap_stage ?? null,
    },
    key_wrap: bundle.key_wrap,
    handshake: {
      status: bundle.handshake?.status ?? null,
      transcript_hash: bundle.handshake?.transcript_hash ?? null,
      bundle_hash: bundle.handshake?.bundle_hash ?? null,
      events: [
        {
          event_type: "sender-prepared",
          recorded_at: bundle.created_at ?? new Date().toISOString(),
          payload: {
            sender_message: bundle.handshake?.sender_message ?? null,
            receiver_message: bundle.handshake?.receiver_message ?? null,
            sender_confirmation: bundle.handshake?.sender_confirmation ?? null,
            receiver_confirmation: bundle.handshake?.receiver_confirmation ?? null,
            transcript_hash: bundle.handshake?.transcript_hash ?? null,
          },
        },
      ],
    },
    consumed_at: bundle.consumed_at ?? null,
  };
}

function loadState(storeDir, offerId) {
  return JSON.parse(fs.readFileSync(statePath(storeDir, offerId), "utf-8"));
}

function saveState(storeDir, offerId, state) {
  fs.writeFileSync(statePath(storeDir, offerId), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function hydrateBundle(bundle, state) {
  return {
    ...bundle,
    transfer: {
      ...(bundle.transfer ?? {}),
      ...(state.transfer ?? {}),
    },
    session: {
      ...(bundle.session ?? {}),
      ...(state.session ?? {}),
    },
    key_wrap: state.key_wrap ?? bundle.key_wrap,
    handshake: {
      ...(bundle.handshake ?? {}),
      ...(state.handshake ?? {}),
      events: state.handshake?.events ?? bundle.handshake?.events ?? [],
    },
    consumed_at: state.consumed_at ?? bundle.consumed_at ?? null,
  };
}

function buildReceipt({ offerId, bundle, publishedAt, bundlePathname }) {
  return {
    schema: RECEIPT_SCHEMA,
    offer_id: offerId,
    published_at: publishedAt,
    offer_status: bundle.transfer?.status ?? "awaiting-accept",
    bundle_path: bundlePathname,
    beam_code_hint: bundle.beam_code_hint,
    file: bundle.file,
    transfer: bundle.transfer,
    handshake: {
      status: bundle.handshake?.status ?? null,
      transcript_hash: bundle.handshake?.transcript_hash ?? null,
    },
  };
}

export function createRendezvousHttpServer(options = {}) {
  const storeDir = ensureStoreDirs(options.storeDir ?? ".claw-beam-rendezvous-http");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true, schema: SERVER_SCHEMA });
      }

      if (req.method === "POST" && url.pathname === "/offers") {
        const body = await readJson(req);
        if (!body?.bundle) {
          return sendJson(res, 400, { error: "bundle is required" });
        }
        const offerId = body.offer_id || generateOfferId();
        const offerFile = offerPath(storeDir, offerId);
        const publishedAt = body.published_at || new Date().toISOString();
        fs.writeFileSync(offerFile, JSON.stringify(body.bundle, null, 2) + "\n", "utf-8");
        saveState(storeDir, offerId, createInitialState(offerId, body.bundle));
        const receipt = buildReceipt({
          offerId,
          bundle: body.bundle,
          publishedAt,
          bundlePathname: offerFile,
        });
        saveReceipt(storeDir, offerId, receipt);
        return sendJson(res, 201, { offer_id: offerId, receipt });
      }

      const offerMatch = url.pathname.match(/^\/offers\/([a-f0-9]{16})$/);
      if (offerMatch && req.method === "GET") {
        const offerId = offerMatch[1];
        if (!fs.existsSync(offerPath(storeDir, offerId)) || !fs.existsSync(receiptPath(storeDir, offerId))) {
          return sendJson(res, 404, { error: "offer not found" });
        }
        const bundle = JSON.parse(fs.readFileSync(offerPath(storeDir, offerId), "utf-8"));
        const state = loadState(storeDir, offerId);
        const receipt = loadReceipt(storeDir, offerId);
        return sendJson(res, 200, { offer_id: offerId, receipt, bundle: hydrateBundle(bundle, state), state });
      }

      const handshakeMatch = url.pathname.match(/^\/offers\/([a-f0-9]{16})\/handshake$/);
      if (handshakeMatch && req.method === "GET") {
        const offerId = handshakeMatch[1];
        if (!fs.existsSync(receiptPath(storeDir, offerId))) {
          return sendJson(res, 404, { error: "offer not found" });
        }
        const state = loadState(storeDir, offerId);
        return sendJson(res, 200, {
          offer_id: offerId,
          handshake: state.handshake ?? { status: null, transcript_hash: null, bundle_hash: null, events: [] },
        });
      }

      if (handshakeMatch && req.method === "POST") {
        const offerId = handshakeMatch[1];
        if (!fs.existsSync(receiptPath(storeDir, offerId))) {
          return sendJson(res, 404, { error: "offer not found" });
        }
        const body = await readJson(req);
        const state = loadState(storeDir, offerId);
        state.handshake = {
          ...(state.handshake ?? {}),
          ...(body.handshake ?? {}),
          events: [
            ...((state.handshake?.events ?? []).filter(Boolean)),
            {
              event_type: body.event_type ?? "handshake-update",
              recorded_at: body.recorded_at ?? new Date().toISOString(),
              payload: body.payload ?? {},
            },
          ],
        };
        saveState(storeDir, offerId, state);
        const receipt = loadReceipt(storeDir, offerId);
        receipt.handshake = {
          status: state.handshake?.status ?? receipt.handshake?.status ?? null,
          transcript_hash: state.handshake?.transcript_hash ?? receipt.handshake?.transcript_hash ?? null,
        };
        saveReceipt(storeDir, offerId, receipt);
        return sendJson(res, 200, { offer_id: offerId, handshake: state.handshake });
      }

      const acceptMatch = url.pathname.match(/^\/offers\/([a-f0-9]{16})\/accept$/);
      if (acceptMatch && req.method === "POST") {
        const offerId = acceptMatch[1];
        if (!fs.existsSync(receiptPath(storeDir, offerId))) {
          return sendJson(res, 404, { error: "offer not found" });
        }
        const body = await readJson(req);
        const receipt = loadReceipt(storeDir, offerId);
        const state = loadState(storeDir, offerId);
        state.transfer = {
          ...(state.transfer ?? {}),
          ...(body.transfer ?? {}),
          status: body.offer_status ?? body.transfer?.status ?? state.transfer?.status ?? "accepted",
          accepted_at: body.accepted_at ?? body.transfer?.accepted_at ?? state.transfer?.accepted_at ?? new Date().toISOString(),
          receiver_label: body.receiver_label ?? body.transfer?.receiver_label ?? state.transfer?.receiver_label ?? "receiver",
        };
        state.session = {
          ...(state.session ?? {}),
          ...(body.session ?? {}),
        };
        state.key_wrap = body.key_wrap ?? state.key_wrap;
        state.handshake = {
          ...(state.handshake ?? {}),
          ...(body.handshake ?? {}),
        };
        saveState(storeDir, offerId, state);
        receipt.offer_status = state.transfer?.status ?? receipt.offer_status;
        receipt.accepted_at = state.transfer?.accepted_at ?? receipt.accepted_at ?? new Date().toISOString();
        receipt.receiver_label = state.transfer?.receiver_label ?? receipt.receiver_label ?? "receiver";
        receipt.handshake = {
          status: state.handshake?.status ?? receipt.handshake?.status ?? null,
          transcript_hash: state.handshake?.transcript_hash ?? receipt.handshake?.transcript_hash ?? null,
        };
        saveReceipt(storeDir, offerId, receipt);
        return sendJson(res, 200, { offer_id: offerId, receipt, state });
      }

      const consumeMatch = url.pathname.match(/^\/offers\/([a-f0-9]{16})\/consume$/);
      if (consumeMatch && req.method === "POST") {
        const offerId = consumeMatch[1];
        if (!fs.existsSync(receiptPath(storeDir, offerId))) {
          return sendJson(res, 404, { error: "offer not found" });
        }
        const body = await readJson(req);
        const receipt = loadReceipt(storeDir, offerId);
        const state = loadState(storeDir, offerId);
        state.transfer = {
          ...(state.transfer ?? {}),
          ...(body.transfer ?? {}),
          status: body.offer_status ?? body.transfer?.status ?? "consumed",
        };
        state.handshake = {
          ...(state.handshake ?? {}),
          ...(body.handshake ?? {}),
        };
        state.consumed_at = body.consumed_at ?? new Date().toISOString();
        saveState(storeDir, offerId, state);
        receipt.offer_status = state.transfer?.status ?? "consumed";
        receipt.consumed_at = state.consumed_at;
        receipt.handshake = {
          status: state.handshake?.status ?? receipt.handshake?.status ?? null,
          transcript_hash: state.handshake?.transcript_hash ?? receipt.handshake?.transcript_hash ?? null,
        };
        saveReceipt(storeDir, offerId, receipt);
        return sendJson(res, 200, { offer_id: offerId, receipt, state });
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (error) {
      return sendJson(res, 500, { error: error?.message || String(error) });
    }
  });

  return {
    storeDir,
    server,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolve(address);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
