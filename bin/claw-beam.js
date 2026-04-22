#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acceptBeamBundle,
  acceptBeamOffer,
  acceptBeamOfferHttp,
  inspectBeamOffer,
  inspectBeamOfferHttp,
  publishBeamBundleToHttpRendezvous,
  publishBeamBundleToRendezvous,
  receiveBeamBundle,
  receiveBeamOffer,
  receiveBeamOfferHttp,
  renderOfferSummary,
  renderRendezvousSummary,
  writeBeamBundle,
} from "../src/claw-beam.js";
import { createRendezvousHttpServer } from "../src/rendezvous-http.js";
import { sendSimple, receiveSimple, encodeToken, decodeToken } from "../src/simple.js";
import { checkNgrokAvailable } from "../src/ngrok-tunnel.js";

function usage() {
  console.error("Usage:");
  console.error("  claw-beam send --filepath <file> [--port <port>] [--host <host>] [--ngrok] [--ngrok-region <region>]");
  console.error("  claw-beam receive --token <token> [--filespath <dir>]");
  console.error("");
  console.error("Legacy commands:");
  console.error("  claw-beam raw-send <file>");
  console.error("  claw-beam raw-accept <bundle.json> <code> [receiver-label]");
  console.error("  claw-beam raw-receive <bundle.json> <code> [--keep-bundle]");
  console.error("  claw-beam send-rendezvous <file> <rendezvous-dir>");
  console.error("  claw-beam accept-offer <rendezvous-dir> <offer-id> <code> [receiver-label]");
  console.error("  claw-beam receive-offer <rendezvous-dir> <offer-id> <code> [--keep-bundle]");
  console.error("  claw-beam send-http <file> <base-url>");
  console.error("  claw-beam accept-http <base-url> <offer-id> <code> [receiver-label]");
  console.error("  claw-beam receive-http <base-url> <offer-id> <code> [--keep-bundle]");
  console.error("  claw-beam inspect <bundle.json>");
  console.error("  claw-beam inspect-offer <rendezvous-dir> <offer-id>");
  console.error("  claw-beam inspect-http <base-url> <offer-id>");
  console.error("  claw-beam serve-rendezvous [store-dir] [port]");
  console.error("  claw-beam decode-token <token>");
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].replace(/^--/, "");
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { args, positional };
}

const [, , command, ...restArgs] = process.argv;

if (!command) {
  usage();
  process.exit(1);
}

async function run() {
  // ─── Simplified commands ───

  if (command === "send") {
    const { args, positional } = parseArgs(restArgs);
    // New simplified flow: --filepath flag
    if (args.filepath || args.file || args.f) {
      const filePath = args.filepath || args.file || args.f;
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        console.error(`Error: file not found: ${resolved}`);
        process.exit(1);
      }

      const port = args.port ? Number(args.port) : 0;
      const host = args.host || "127.0.0.1";
      const useNgrok = args.ngrok === true;
      const ngrokRegion = args["ngrok-region"] || process.env.NGROK_REGION || "us";
      const ngrokAuthToken = args["ngrok-authtoken"] || null;

      if (useNgrok) {
        const ngrokCheck = await checkNgrokAvailable();
        if (!ngrokCheck.available) {
          console.error(`Error: --ngrok requested but ngrok is not available: ${ngrokCheck.error}`);
          process.exit(1);
        }
      }

      const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-send-"));
      const result = await sendSimple(resolved, { port, host, storeDir, ngrok: useNgrok, ngrokRegion, ngrokAuthToken });

      console.log(`✉ beam sent`);
      console.log(`  file: ${path.basename(resolved)} (${fs.statSync(resolved).size} bytes)`);
      console.log(`  token: ${result.token}`);
      console.log(`  rendezvous: ${result.baseUrl}`);
      if (result.ngrokTunnel) {
        console.log(`  ngrok tunnel: ${result.ngrokTunnel.publicUrl} → localhost:${port || "auto"}`);
      }
      console.log(`  offer: ${result.offerId}`);
      console.log(`  code: ${result.beamCode}`);
      console.log();
      console.log("Share the token with the receiver. They run:");
      console.log(`  claw-beam receive --token ${result.token}`);
      console.log();
      console.log("Server is running. Press Ctrl+C when transfer is complete.");

      // Keep server alive until killed
      await new Promise(() => {});
      return;
    }

    // Legacy raw-send flow: positional file path
    if (positional.length >= 1) {
      const { bundle, bundlePath, beamCode } = await writeBeamBundle(positional[0]);
      console.log(`beam bundle written: ${bundlePath}`);
      console.log(renderOfferSummary(bundle));
      console.log(`beam code: ${beamCode}`);
      console.log("next step: receiver should accept the bundle with the beam code before receive.");
      console.log("share the bundle file and beam code through separate channels for this POC.");
      return;
    }

    console.error("Error: --filepath is required");
    console.error("Usage: claw-beam send --filepath <file> [--port <port>] [--host <host>] [--ngrok] [--ngrok-region <region>]");
    process.exit(1);
  }

  if (command === "receive") {
    const { args, positional } = parseArgs(restArgs);
    // New simplified flow: --token flag
    if (args.token || args.t) {
      const token = args.token || args.t;
      const filespath = args.filespath || args.files || args.o || ".";
      const keepBundle = args["keep-bundle"] === true;

      try {
        const result = await receiveSimple(token, filespath, { keepBundle });
        console.log(`✅ beam received`);
        console.log(`  file: ${result.fileName}`);
        console.log(`  size: ${result.sizeBytes} bytes`);
        console.log(`  sha256: ${result.sha256}`);
        console.log(`  path: ${result.outPath}`);
      } catch (error) {
        console.error(`Error: ${error?.message || String(error)}`);
        process.exit(1);
      }
      return;
    }

    // Legacy raw-receive flow: positional bundle + code
    if (positional.length >= 2) {
      const keepBundle = positional.includes("--keep-bundle") || args["keep-bundle"] === true;
      const { bundle, outPath } = await receiveBeamBundle(positional[0], positional[1], ".out", {
        consume: true,
        deleteBundleOnConsume: !keepBundle,
      });
      console.log(`beam received: ${outPath}`);
      console.log(renderOfferSummary(bundle));
      if (!keepBundle) console.log("bundle removed after consume.");
      return;
    }

    console.error("Error: --token is required");
    console.error("Usage: claw-beam receive --token <token> [--filespath <dir>]");
    process.exit(1);
  }

  if (command === "decode-token") {
    const token = restArgs[0];
    if (!token) {
      console.error("Usage: claw-beam decode-token <token>");
      process.exit(1);
    }
    try {
      const decoded = decodeToken(token);
      console.log(JSON.stringify(decoded, null, 2));
    } catch (error) {
      console.error(`Error: ${error?.message || String(error)}`);
      process.exit(1);
    }
    return;
  }

  // ─── Legacy commands ───

  const [arg1, arg2, arg3] = restArgs;

  if (command === "raw-send") {
    if (!arg1) {
      usage();
      process.exit(1);
    }
    const { bundle, bundlePath, beamCode } = await writeBeamBundle(arg1);
    console.log(`beam bundle written: ${bundlePath}`);
    console.log(renderOfferSummary(bundle));
    console.log(`beam code: ${beamCode}`);
    console.log("next step: receiver should accept the bundle with the beam code before receive.");
    console.log("share the bundle file and beam code through separate channels for this POC.");
    return;
  }

  if (command === "send-rendezvous") {
    if (!arg1 || !arg2) {
      usage();
      process.exit(1);
    }
    const { bundle, bundlePath, beamCode } = await writeBeamBundle(arg1);
    const { offerId, receipt } = await publishBeamBundleToRendezvous(bundlePath, arg2);
    console.log(`beam bundle written: ${bundlePath}`);
    console.log(renderOfferSummary(bundle));
    console.log(`offer published: ${offerId}`);
    console.log(renderRendezvousSummary(receipt));
    console.log(`beam code: ${beamCode}`);
    return;
  }

  if (command === "send-http") {
    if (!arg1 || !arg2) {
      usage();
      process.exit(1);
    }
    const { bundle, bundlePath, beamCode } = await writeBeamBundle(arg1);
    const { offerId, receipt } = await publishBeamBundleToHttpRendezvous(bundlePath, arg2);
    console.log(`beam bundle written: ${bundlePath}`);
    console.log(renderOfferSummary(bundle));
    console.log(`offer published: ${offerId}`);
    console.log(renderRendezvousSummary(receipt));
    console.log(`beam code: ${beamCode}`);
    return;
  }

  if (command === "accept") {
    // Legacy raw-accept: positional bundle + code + label
    if (restArgs.length < 2) {
      usage();
      process.exit(1);
    }
    const receiverLabel = arg3 || "receiver";
    const bundle = await acceptBeamBundle(arg1, arg2, { receiverLabel });
    console.log(`beam accepted: ${path.resolve(arg1)}`);
    console.log(renderOfferSummary(bundle));
    return;
  }

  if (command === "accept-offer") {
    if (!arg1 || !arg2 || !arg3) {
      usage();
      process.exit(1);
    }
    const receiverLabel = process.argv[6] || "receiver";
    const { bundle, receipt } = await acceptBeamOffer(arg1, arg2, arg3, { receiverLabel });
    console.log(`offer accepted: ${arg2}`);
    console.log(renderRendezvousSummary(receipt));
    console.log(renderOfferSummary(bundle));
    return;
  }

  if (command === "accept-http") {
    if (!arg1 || !arg2 || !arg3) {
      usage();
      process.exit(1);
    }
    const receiverLabel = process.argv[6] || "receiver";
    const { bundle, receipt } = await acceptBeamOfferHttp(arg1, arg2, arg3, { receiverLabel });
    console.log(`offer accepted: ${arg2}`);
    console.log(renderRendezvousSummary(receipt));
    console.log(renderOfferSummary(bundle));
    return;
  }

  if (command === "raw-receive") {
    if (!arg1 || !arg2) {
      usage();
      process.exit(1);
    }
    const keepBundle = arg3 === "--keep-bundle";
    const { bundle, outPath } = await receiveBeamBundle(arg1, arg2, ".out", {
      consume: true,
      deleteBundleOnConsume: !keepBundle,
    });
    console.log(`beam received: ${outPath}`);
    console.log(renderOfferSummary(bundle));
    if (!keepBundle) console.log("bundle removed after consume.");
    return;
  }

  if (command === "receive-offer") {
    if (!arg1 || !arg2 || !arg3) {
      usage();
      process.exit(1);
    }
    const keepBundle = process.argv[6] === "--keep-bundle";
    const { bundle, outPath, receipt } = await receiveBeamOffer(arg1, arg2, arg3, ".out", {
      consume: true,
      deleteBundleOnConsume: !keepBundle,
    });
    console.log(`beam received: ${outPath}`);
    console.log(renderRendezvousSummary(receipt));
    console.log(renderOfferSummary(bundle));
    if (!keepBundle) console.log("bundle removed after consume.");
    return;
  }

  if (command === "receive-http") {
    if (!arg1 || !arg2 || !arg3) {
      usage();
      process.exit(1);
    }
    const keepBundle = process.argv[6] === "--keep-bundle";
    const { bundle, outPath, receipt } = await receiveBeamOfferHttp(arg1, arg2, arg3, ".out", {
      consume: true,
      deleteBundleOnConsume: !keepBundle,
    });
    console.log(`beam received: ${outPath}`);
    console.log(renderRendezvousSummary(receipt));
    console.log(renderOfferSummary(bundle));
    if (!keepBundle) console.log("bundle removed after consume.");
    return;
  }

  if (command === "inspect") {
    if (!arg1) {
      usage();
      process.exit(1);
    }
    const payload = JSON.parse(fs.readFileSync(path.resolve(arg1), "utf-8"));
    console.log(renderOfferSummary(payload));
    return;
  }

  if (command === "inspect-offer") {
    if (!arg1 || !arg2) {
      usage();
      process.exit(1);
    }
    const { receipt, bundle } = inspectBeamOffer(arg1, arg2);
    console.log(renderRendezvousSummary(receipt));
    console.log(renderOfferSummary(bundle));
    return;
  }

  if (command === "inspect-http") {
    if (!arg1 || !arg2) {
      usage();
      process.exit(1);
    }
    const { receipt, bundle } = await inspectBeamOfferHttp(arg1, arg2);
    console.log(renderRendezvousSummary(receipt));
    console.log(renderOfferSummary(bundle));
    return;
  }

  if (command === "serve-rendezvous") {
    const storeDir = arg1 || ".claw-beam-rendezvous-http";
    const port = Number(arg2 || 0);
    const runtime = createRendezvousHttpServer({ storeDir });
    const address = await runtime.listen(port);
    console.log(`rendezvous listening: http://${address.address}:${address.port}`);
    console.log(`store_dir: ${runtime.storeDir}`);
    await new Promise(() => {});
  }

  usage();
  process.exit(1);
}

try {
  await run();
  process.exit(0);
} catch (error) {
  if (["receive", "receive-offer", "receive-http", "raw-receive"].includes(command)) {
    console.error(error?.message === "Beam bundle must be accepted before receive."
      ? "Beam bundle must be accepted before receive."
      : error?.message === "Beam session is incomplete."
        ? "Beam session is incomplete."
        : error?.message === "Beam handshake is incomplete."
          ? "Beam handshake is incomplete."
          : "Invalid beam code or corrupted bundle.");
    process.exit(1);
  }

  if (["accept", "accept-offer", "accept-http", "raw-accept"].includes(command)) {
    console.error("Invalid beam code or corrupted bundle.");
    process.exit(1);
  }

  console.error(error?.message || String(error));
  process.exit(1);
}