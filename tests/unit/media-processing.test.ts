import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { analyzeScreenshot, getImageMetadata } from "../../src/utils/screenshot-analyzer.js";
import { FrameExtractor } from "../../src/utils/video-analysis/frame-extractor.js";

describe("media processing compatibility", () => {
  it("reads generated PNG metadata and analyzes dimensions", async () => {
    const png = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: { r: 20, g: 80, b: 160, alpha: 0.75 },
      },
    }).png().toBuffer();

    const metadata = await getImageMetadata(png);
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 180);
    assert.equal(metadata.format, "png");
    assert.equal(metadata.orientation, "landscape");
    assert.equal(metadata.aspectRatio, "16:9");
    assert.equal(metadata.hasAlpha, true);

    const analysis = await analyzeScreenshot(png, { enableOCR: false });
    assert.deepEqual(analysis.metadata, metadata);
    assert.equal(analysis.deviceInfo?.navigationBarVisible, undefined);
  });

  it("extracts and resizes a frame from a generated video", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "mcp-zebrunner-media-"));
    const videoPath = join(workDir, "fixture.mp4");
    const extractor = new FrameExtractor(false);

    try {
      const generated = spawnSync(
        ffmpegPath.path,
        [
          "-y",
          "-f", "lavfi",
          "-i", "color=c=blue:s=64x48:d=1",
          "-c:v", "mpeg4",
          "-pix_fmt", "yuv420p",
          videoPath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(generated.status, 0, generated.stderr || "ffmpeg fixture generation failed");

      const frames = await extractor.extractFrames(
        videoPath,
        0.5,
        "full_test",
        undefined,
        30,
        1,
        false,
      );

      assert.equal(frames.length, 1);
      assert.ok(frames[0].imageBase64);
      const frameMetadata = await sharp(Buffer.from(frames[0].imageBase64!, "base64")).metadata();
      assert.equal(frameMetadata.width, 64);
      assert.equal(frameMetadata.height, 48);
      assert.equal(frameMetadata.format, "png");
    } finally {
      extractor.cleanupFrames([]);
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
