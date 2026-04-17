#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  acceptBeamBundle,
  receiveBeamBundle,
  renderOfferSummary,
  writeBeamBundle,
} from "../src/claw-beam.js";

function usage() {
  console.error("Usage:");
  console.error("  claw-beam send <file>");
  console.error("  claw-beam accept <bundle.json> [receiver-label]");
  console.error("  claw-beam receive <bundle.json> <code> [--keep-bundle]");
  console.error("  claw-beam inspect <bundle.json>");
}

const [, , command, arg1, arg2, arg3] = process.argv;

if (!command) {
  usage();
  process.exit(1);
}

function run() {
  if (command === "send") {
    if (!arg1) {
      usage();
      process.exit(1);
    }
    const { bundle, bundlePath } = writeBeamBundle(arg1);
    console.log(`beam bundle written: ${bundlePath}`);
    console.log(renderOfferSummary(bundle));
    console.log("next step: receiver should accept the bundle before receive.");
    console.log("share the bundle file and beam code through separate channels for this POC.");
    return;
  }

  if (command === "accept") {
    if (!arg1) {
      usage();
      process.exit(1);
    }
    const receiverLabel = arg2 || "receiver";
    const bundle = acceptBeamBundle(arg1, { receiverLabel });
    console.log(`beam accepted: ${path.resolve(arg1)}`);
    console.log(renderOfferSummary(bundle));
    return;
  }

  if (command === "receive") {
    if (!arg1 || !arg2) {
      usage();
      process.exit(1);
    }
    const keepBundle = arg3 === "--keep-bundle";
    const { bundle, outPath } = receiveBeamBundle(arg1, arg2, ".out", {
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

  if (command === "inspect") {
    if (!arg1) {
      usage();
      process.exit(1);
    }
    const payload = JSON.parse(fs.readFileSync(path.resolve(arg1), "utf-8"));
    console.log(renderOfferSummary(payload));
    return;
  }

  usage();
  process.exit(1);
}

try {
  run();
  process.exit(0);
} catch (error) {
  if (command === "receive") {
    console.error(error?.message === "Beam bundle must be accepted before receive."
      ? "Beam bundle must be accepted before receive."
      : "Invalid beam code or corrupted bundle.");
    process.exit(1);
  }

  console.error(error?.message || String(error));
  process.exit(1);
}
