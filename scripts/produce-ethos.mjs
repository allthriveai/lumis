import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadConfig } from "../dist/config.js";
import { createHeyGenClient } from "../dist/studio/heygen.js";

const config = loadConfig();
const studio = config.studio;

if (!studio?.heygenApiKey || !studio?.heygenAvatarId) {
  console.error("Missing studio config. Set VAULT_PATH and ensure .lumisrc has studio keys.");
  process.exit(1);
}

const script = readFileSync(join(import.meta.dirname, "ethos-script.txt"), "utf-8");

console.log(`Script: ${script.split(/\s+/).length} words, ${script.length} chars`);
console.log("Sending to HeyGen...");

const heygen = createHeyGenClient(
  studio.heygenApiKey,
  studio.heygenAvatarId,
  studio.heygenVoiceId,
);

try {
  const videoId = await heygen.generateVideo(script);
  console.log(`Video generation started. Video ID: ${videoId}`);
  console.log("Polling for completion...");

  const POLL_INTERVAL = 15_000;
  const MAX_POLLS = 120;

  for (let i = 0; i < MAX_POLLS; i++) {
    const result = await heygen.checkStatus(videoId);
    const elapsed = ((i + 1) * POLL_INTERVAL / 1000).toFixed(0);
    console.log(`[${elapsed}s] Status: ${result.status}`);

    if (result.status === "completed" && result.videoUrl) {
      console.log("Video ready! Downloading...");

      const rawDir = join(process.cwd(), "public", "raw");
      await mkdir(rawDir, { recursive: true });
      const outputPath = join(rawDir, "ethos-academy-story.mp4");
      await heygen.downloadVideo(result.videoUrl, outputPath);

      console.log(`Raw video saved: ${outputPath}`);
      process.exit(0);
    }

    if (result.status === "failed") {
      console.error("HeyGen video generation failed.");
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  console.error("Timed out waiting for video.");
  process.exit(1);
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
}
