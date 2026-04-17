#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  receiveBeamBundle,
  renderOfferSummary,
  writeBeamBundle,
} from "../src/claw-beam.js";

function usage() {
  console.error("Usage:");
  console.error("  claw-beam send <file>");
  console.error("  claw-beam receive <bundle.json> <code>");
  console.error("  claw-beam inspect <bundle.json>");
}

const [, , command, arg1, arg2] = process.argv;

if (!command) {
  usage();
  process.exit(1);
}

if (command === "send") {
  if (!arg1) {
    usage();
    process.exit(1);
  }
  const { bundle, bundlePath } = writeBeamBundle(arg1);
  console.log(`beam bundle written: ${bundlePath}`);
  console.log(renderOfferSummary(bundle));
  console.log("share the bundle file and beam code through separate channels for this POC.");
  process.exit(0);
}

if (command === "receive") {
  if (!arg1 || !arg2) {
    usage();
    process.exit(1);
  }
  const { bundle, outPath } = receiveBeamBundle(arg1, arg2);
  console.log(`beam received: ${outPath}`);
  console.log(renderOfferSummary(bundle));
  process.exit(0);
}

if (command === "inspect") {
  if (!arg1) {
    usage();
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(path.resolve(arg1), "utf-8"));
  console.log(renderOfferSummary(payload));
  process.exit(0);
}

usage();
process.exit(1);
