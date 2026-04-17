import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";

const SERVER_SCHEMA = "claw-beam.rendezvous.http.v1";
const RECEIPT_SCHEMA = "claw-beam.rendezvous.v1";

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

function loadReceipt(storeDir, offerId) {
  return JSON.parse(fs.readFileSync(receiptPath(storeDir, offerId), "utf-8"));
}

function saveReceipt(storeDir, offerId, receipt) {
  fs.writeFileSync(receiptPath(storeDir, offerId), JSON.stringify(receipt, null, 2) + "\n", "utf-8");
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
        const receipt = loadReceipt(storeDir, offerId);
        return sendJson(res, 200, { offer_id: offerId, receipt, bundle });
      }

      const acceptMatch = url.pathname.match(/^\/offers\/([a-f0-9]{16})\/accept$/);
      if (acceptMatch && req.method === "POST") {
        const offerId = acceptMatch[1];
        if (!fs.existsSync(receiptPath(storeDir, offerId))) {
          return sendJson(res, 404, { error: "offer not found" });
        }
        const body = await readJson(req);
        const receipt = loadReceipt(storeDir, offerId);
        if (body.bundle) {
          fs.writeFileSync(offerPath(storeDir, offerId), JSON.stringify(body.bundle, null, 2) + "\n", "utf-8");
        }
        receipt.offer_status = body.offer_status ?? receipt.offer_status;
        receipt.accepted_at = body.accepted_at ?? receipt.accepted_at ?? new Date().toISOString();
        receipt.receiver_label = body.receiver_label ?? receipt.receiver_label ?? "receiver";
        receipt.handshake = body.handshake ?? receipt.handshake;
        saveReceipt(storeDir, offerId, receipt);
        return sendJson(res, 200, { offer_id: offerId, receipt });
      }

      const consumeMatch = url.pathname.match(/^\/offers\/([a-f0-9]{16})\/consume$/);
      if (consumeMatch && req.method === "POST") {
        const offerId = consumeMatch[1];
        if (!fs.existsSync(receiptPath(storeDir, offerId))) {
          return sendJson(res, 404, { error: "offer not found" });
        }
        const body = await readJson(req);
        const receipt = loadReceipt(storeDir, offerId);
        if (body.bundle) {
          fs.writeFileSync(offerPath(storeDir, offerId), JSON.stringify(body.bundle, null, 2) + "\n", "utf-8");
        }
        receipt.offer_status = body.offer_status ?? "consumed";
        receipt.consumed_at = body.consumed_at ?? new Date().toISOString();
        receipt.handshake = body.handshake ?? receipt.handshake;
        saveReceipt(storeDir, offerId, receipt);
        return sendJson(res, 200, { offer_id: offerId, receipt });
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
