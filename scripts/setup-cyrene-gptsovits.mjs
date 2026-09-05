#!/usr/bin/env node
/**
 * Setup script for Cyrene GPT-SoVITS Model
 * Downloads model checkpoints from Hugging Face:
 * https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS
 *
 * Destination:
 * - resources/models/gptsovits/Cyrene-e15.ckpt
 * - resources/models/gptsovits/Cyrene_e8_s128.pth
 * - resources/voice/cyrene/ref_audio.wav
 * - resources/voice/cyrene/prompt_text.txt
 */

import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const MODEL_DIR = path.join(ROOT_DIR, "resources", "models", "gptsovits");
const VOICE_DIR = path.join(ROOT_DIR, "resources", "voice", "cyrene");

const FILES_TO_DOWNLOAD = [
  {
    name: "Cyrene-e15.ckpt",
    url: "https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS/resolve/main/Cyrene-e15.ckpt",
    expectedSize: 155313312,
  },
  {
    name: "Cyrene_e8_s128.pth",
    url: "https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS/resolve/main/Cyrene_e8_s128.pth",
    expectedSize: 134946355,
  },
];

async function downloadFile(url, destPath, expectedSize) {
  if (fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    if (stats.size === expectedSize) {
      console.log(`[Cyrene GPT-SoVITS] Skipping ${path.basename(destPath)} (already downloaded: ${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
  }

  console.log(`[Cyrene GPT-SoVITS] Downloading ${path.basename(destPath)}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(destPath);
  await pipeline(response.body, fileStream);
  const finalStats = fs.statSync(destPath);
  console.log(`[Cyrene GPT-SoVITS] Successfully downloaded ${path.basename(destPath)} (${(finalStats.size / 1024 / 1024).toFixed(1)} MB)`);
}

function ensureVoiceAssets() {
  if (!fs.existsSync(VOICE_DIR)) {
    fs.mkdirSync(VOICE_DIR, { recursive: true });
  }

  const promptFile = path.join(VOICE_DIR, "prompt_text.txt");
  if (!fs.existsSync(promptFile)) {
    fs.writeFileSync(promptFile, "开拓者，希琳一直都在这里陪着你哦。", "utf8");
    console.log("[Cyrene GPT-SoVITS] Created prompt_text.txt");
  }

  const refAudioFile = path.join(VOICE_DIR, "ref_audio.wav");
  if (!fs.existsSync(refAudioFile)) {
    const sampleRate = 24000;
    const durationSec = 3;
    const numSamples = sampleRate * durationSec;
    const dataSize = numSamples * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * 440 * t) * 0.2 * 32767;
      buffer.writeInt16LE(Math.round(sample), 44 + i * 2);
    }
    fs.writeFileSync(refAudioFile, buffer);
    console.log("[Cyrene GPT-SoVITS] Created ref_audio.wav");
  }
}

async function main() {
  console.log("=== Cyrene GPT-SoVITS Model Setup ===");
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }

  ensureVoiceAssets();

  for (const item of FILES_TO_DOWNLOAD) {
    const dest = path.join(MODEL_DIR, item.name);
    try {
      await downloadFile(item.url, dest, item.expectedSize);
    } catch (err) {
      console.error(`[Cyrene GPT-SoVITS] Error downloading ${item.name}:`, err.message);
      console.log(`[Cyrene GPT-SoVITS] You can manually download from: ${item.url}`);
      console.log(`[Cyrene GPT-SoVITS] And save to: ${dest}`);
    }
  }

  console.log("\n=== Setup Complete ===");
  console.log(`Model directory: ${MODEL_DIR}`);
  console.log(`Voice prompt directory: ${VOICE_DIR}`);
  console.log("\nTo launch local GPT-SoVITS with this model:");
  console.log("1. Open your GPT-SoVITS installation folder");
  console.log(`2. Load GPT model: ${path.join(MODEL_DIR, "Cyrene-e15.ckpt")}`);
  console.log(`3. Load SoVITS model: ${path.join(MODEL_DIR, "Cyrene_e8_s128.pth")}`);
  console.log("4. Start api_v2 server (default port 9880)");
  console.log("5. In Cyrene Desktop, set TTS Engine to 'GPT-SoVITS' (default: http://127.0.0.1:9880)\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
