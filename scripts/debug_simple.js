#!/usr/bin/env node
import { sendSimple, receiveSimple } from "../src/simple.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-debug-simple-"));
const filePath = path.join(tempDir, "debug-test.txt");
fs.writeFileSync(filePath, "debug simple round-trip\n", "utf-8");

console.log("Step 1: sendSimple...");
const sendResult = await sendSimple(filePath, { storeDir: path.join(tempDir, "store") });
console.log("Token:", sendResult.token);
console.log("Offer:", sendResult.offerId);
console.log("Code:", sendResult.beamCode);
console.log("URL:", sendResult.baseUrl);

console.log("\nStep 2: receiveSimple...");
const recvDir = path.join(tempDir, "recv");
const recvResult = await receiveSimple(sendResult.token, recvDir);
console.log("File:", recvResult.fileName);
console.log("Path:", recvResult.outPath);
console.log("Size:", recvResult.sizeBytes);
console.log("SHA256:", recvResult.sha256);

const content = fs.readFileSync(recvResult.outPath, "utf-8");
console.log("Content:", JSON.stringify(content));
console.log("Match:", content === "debug simple round-trip\n");

await sendResult.server.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log("\nDone.");