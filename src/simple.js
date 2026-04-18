// claw-beam simple flow: send → token, receive token → file
// This module wraps the rendezvous HTTP flow into the simplest possible UX.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeBeamBundle, publishBeamBundleToHttpRendezvous, acceptBeamOfferHttp, receiveBeamOfferHttp } from "./claw-beam.js";
import { createRendezvousHttpServer } from "./rendezvous-http.js";
import { encodeToken, decodeToken } from "./token.js";

export { encodeToken, decodeToken };

/**
 * Start a rendezvous server, send a file, auto-accept the offer, and return a token.
 * The token contains everything the receiver needs.
 * Returns { token, baseUrl, offerId, beamCode, server } where server has .close().
 */
export async function sendSimple(filePath, options = {}) {
  const {
    host = "127.0.0.1",
    port = 0,
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-send-")),
    receiverLabel = "receiver",
    keepServerAlive = false,
  } = options;

  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  // Start rendezvous server
  const runtime = createRendezvousHttpServer({ storeDir });
  const address = await runtime.listen(port, host);
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    // Create and publish the beam bundle
    const tempSendDir = path.join(storeDir, "send-out");
    fs.mkdirSync(tempSendDir, { recursive: true });
    const { beamCode, bundlePath } = await writeBeamBundle(resolved, tempSendDir);
    const { offerId } = await publishBeamBundleToHttpRendezvous(bundlePath, baseUrl);

    // Auto-accept so the receiver only needs to receive
    await acceptBeamOfferHttp(baseUrl, offerId, beamCode, { receiverLabel });

    const token = encodeToken({ baseUrl, offerId, code: beamCode });

    if (keepServerAlive) {
      return { token, baseUrl, offerId, beamCode, server: runtime };
    }

    // Return info but don't close yet — caller controls server lifecycle
    return { token, baseUrl, offerId, beamCode, server: runtime };
  } catch (error) {
    // Best-effort cleanup on error
    try { await runtime.close(); } catch {}
    throw error;
  }
}

/**
 * Receive a file given a token.
 * Downloads, decrypts, and writes the file to filespath (defaults to current directory).
 * Returns { outPath, fileName, sizeBytes, sha256 }.
 */
export async function receiveSimple(token, filespath = ".", options = {}) {
  const { keepBundle = false } = options;
  const { baseUrl, offerId, code } = decodeToken(token);

  const resolvedDir = path.resolve(filespath);
  fs.mkdirSync(resolvedDir, { recursive: true });

  const result = await receiveBeamOfferHttp(baseUrl, offerId, code, resolvedDir, {
    consume: true,
    deleteBundleOnConsume: !keepBundle,
  });

  return {
    outPath: result.outPath,
    fileName: result.bundle.file.name,
    sizeBytes: result.bundle.file.size_bytes,
    sha256: result.bundle.file.sha256,
  };
}