#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  acceptBeamBundle,
  acceptBeamOffer,
  inspectBeamOffer,
  publishBeamBundleToRendezvous,
  receiveBeamBundle,
  receiveBeamOffer,
  renderOfferSummary,
  renderRendezvousSummary,
  writeBeamBundle,
} from "../src/claw-beam.js";

function usage() {
  console.error("Usage:");
  console.error("  claw-beam send <file>");
  console.error("  claw-beam send-rendezvous <file> <rendezvous-dir>");
  console.error("  claw-beam accept <bundle.json> <code> [receiver-label]");
  console.error("  claw-beam accept-offer <rendezvous-dir> <offer-id> <code> [receiver-label]");
  console.error("  claw-beam receive <bundle.json> <code> [--keep-bundle]");
  console.error("  claw-beam receive-offer <rendezvous-dir> <offer-id> <code> [--keep-bundle]");
  console.error("  claw-beam inspect <bundle.json>");
  console.error("  claw-beam inspect-offer <rendezvous-dir> <offer-id>");
}

const [, , command, arg1, arg2, arg3] = process.argv;

if (!command) {
  usage();
  process.exit(1);
}

async function run() {
  if (command === "send") {
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

  if (command === "accept") {
    if (!arg1 || !arg2) {
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

  if (command === "receive") {
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
    if (!keepBundle) {
      console.log("bundle removed after consume.");
    }
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
    if (!keepBundle) {
      console.log("bundle removed after consume.");
    }
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

  usage();
  process.exit(1);
}

try {
  await run();
  process.exit(0);
} catch (error) {
  if (command === "receive" || command === "receive-offer") {
    console.error(error?.message === "Beam bundle must be accepted before receive."
      ? "Beam bundle must be accepted before receive."
      : error?.message === "Beam session is incomplete."
        ? "Beam session is incomplete."
        : error?.message === "Beam handshake is incomplete."
          ? "Beam handshake is incomplete."
          : "Invalid beam code or corrupted bundle.");
    process.exit(1);
  }

  if (command === "accept" || command === "accept-offer") {
    console.error("Invalid beam code or corrupted bundle.");
    process.exit(1);
  }

  console.error(error?.message || String(error));
  process.exit(1);
}
