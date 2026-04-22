// claw-beam simple flow: send → token, receive token → file
// This module wraps the rendezvous HTTP flow into the simplest possible UX.
// Supports ngrok tunnels for NAT traversal without exposing a public IP.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { writeBeamBundle, publishBeamBundleToHttpRendezvous, acceptBeamOfferHttp, receiveBeamOfferHttp } from "./claw-beam.js";
import { createRendezvousHttpServer } from "./rendezvous-http.js";
import { encodeToken, decodeToken } from "./token.js";
import { startNgrokTunnel, checkNgrokAvailable } from "./ngrok-tunnel.js";

export { encodeToken, decodeToken };

/**
 * Start a rendezvous server, send a file, auto-accept the offer, and return a token.
 * The token contains everything the receiver needs.
 *
 * Options:
 *   host           - rendezvous bind host (default: 127.0.0.1)
 *   port           - rendezvous bind port (default: 0 = random)
 *   storeDir       - temp directory for rendezvous data
 *   receiverLabel  - label for the receiver in the beam handshake
 *   keepServerAlive - if true, caller controls server lifecycle
 *   ngrok          - if true, start an ngrok tunnel and use the public URL in the token
 *                    so the receiver can reach the sender across NAT without a public IP
 *   ngrokRegion    - ngrok region code (default: "us")
 *   ngrokAuthToken - ngrok auth token (overrides NGROK_AUTHTOKEN env)
 *
 * When ngrok is enabled:
 * - The rendezvous server still binds to localhost
 * - An ngrok tunnel forwards the public HTTPS URL to localhost
 * - The token carries the ngrok URL, not the localhost URL
 * - The ngrok tunnel is auto-destroyed when the server closes
 * - Security: the ngrok URL is inside the PAKE-encrypted token; ngrok only
 *   sees encrypted bytes
 *
 * Returns { token, baseUrl, offerId, beamCode, server, ngrokTunnel? }
 */
export async function sendSimple(filePath, options = {}) {
  const {
    host = "127.0.0.1",
    port = 0,
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-send-")),
    receiverLabel = "receiver",
    keepServerAlive = false,
    ngrok = false,
    ngrokRegion = "us",
    ngrokAuthToken = null,
  } = options;

  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  // Start rendezvous server
  const runtime = createRendezvousHttpServer({ storeDir });
  const address = await runtime.listen(port, host);
  const localUrl = `http://${address.address}:${address.port}`;

  let publicUrl = localUrl;
  let ngrokTunnel = null;

  try {
    // If ngrok tunneling is requested, establish a tunnel to the local server
    if (ngrok) {
      const ngrokCheck = await checkNgrokAvailable();
      if (!ngrokCheck.available) {
        throw new Error(
          `ngrok tunneling requested but not available: ${ngrokCheck.error}` +
          "\nInstall pyngrok (pip install pyngrok) or ngrok (https://ngrok.com/download)"
        );
      }

      ngrokTunnel = await startNgrokTunnel(address.port, {
        region: ngrokRegion,
        authToken: ngrokAuthToken,
      });
      publicUrl = ngrokTunnel.publicUrl;

      // Ensure the tunnel is reachable before proceeding
      const tunnelOk = await probeUrl(publicUrl);
      if (!tunnelOk) {
        throw new Error(
          `ngrok tunnel established at ${publicUrl} but health check failed. ` +
          "The tunnel may not be ready yet."
        );
      }
    }

    // Create and publish the beam bundle
    const tempSendDir = path.join(storeDir, "send-out");
    fs.mkdirSync(tempSendDir, { recursive: true });
    const { beamCode, bundlePath } = await writeBeamBundle(resolved, tempSendDir);
    const { offerId } = await publishBeamBundleToHttpRendezvous(bundlePath, publicUrl);

    // Auto-accept so the receiver only needs to receive
    await acceptBeamOfferHttp(publicUrl, offerId, beamCode, { receiverLabel });

    const token = encodeToken({ baseUrl: publicUrl, offerId, code: beamCode });

    const result = {
      token,
      baseUrl: publicUrl,
      localUrl,
      offerId,
      beamCode,
      server: runtime,
    };
    if (ngrokTunnel) {
      result.ngrokTunnel = ngrokTunnel;
    }

    // Override the close method to also tear down the ngrok tunnel
    if (ngrokTunnel) {
      const originalClose = runtime.close.bind(runtime);
      runtime.close = async () => {
        try {
          await ngrokTunnel.close();
        } catch {
          // Best-effort ngrok cleanup
        }
        return originalClose();
      };
    }

    return result;
  } catch (error) {
    // Best-effort cleanup on error
    if (ngrokTunnel) {
      try { await ngrokTunnel.close(); } catch {}
    }
    try { await runtime.close(); } catch {}
    throw error;
  }
}

/**
 * Probe a URL to check if it's reachable (GET /health).
 * Returns true if the server responded, false otherwise.
 */
function probeUrl(urlStr) {
  return new Promise((resolve) => {
    try {
      const url = new URL("/health", urlStr);
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(
        url,
        { method: "GET", timeout: 5000 },
        (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
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