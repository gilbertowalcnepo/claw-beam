#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createBeamOffer, renderOfferSummary } from "../src/claw-beam.js";

function usage() {
  console.error("Usage:");
  console.error("  claw-beam send <file>");
  console.error("  claw-beam inspect <offer.json>");
}

const [, , command, target] = process.argv;

if (!command || !target) {
  usage();
  process.exit(1);
}

if (command === "send") {
  const offer = createBeamOffer(target);
  const outDir = path.resolve(".out");
  fs.mkdirSync(outDir, { recursive: true });
  const offerPath = path.join(outDir, `${path.basename(target)}.beam.json`);
  fs.writeFileSync(offerPath, JSON.stringify(offer, null, 2) + "\n", "utf-8");
  console.log(`beam offer written: ${offerPath}`);
  console.log(renderOfferSummary(offer));
  process.exit(0);
}

if (command === "inspect") {
  const payload = JSON.parse(fs.readFileSync(path.resolve(target), "utf-8"));
  console.log(renderOfferSummary(payload));
  process.exit(0);
}

usage();
process.exit(1);
