import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { ExtractedFrame, FrameAnalysis } from './types.js';

// Set FFmpeg and FFprobe paths
ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

/**
 * FrameExtractor class
 * Extracts frames from video at strategic timestamps
 */
export class FrameExtractor {
  private tempDir: string;

  constructor(private debug: boolean = false) {
    this.tempDir = path.join(os.tmpdir(), 'mcp-zebrunner', 'frames');
    
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Extract frames from video based on extraction mode
   */
  async extractFrames(
    videoPath: string,
    videoDuration: number,
    extractionMode: 'failure_focused' | 'full_test' | 'smart',
    failureTimestamp?: number,
    failureWindowSeconds: number = 30,
    frameInterval: number = 5,
    includeOCR: boolean = true
  ): Promise<FrameAnalysis[]> {
    try {
      if (this.debug) {
        console.log(`[FrameExtractor] Starting frame extraction (${extractionMode} mode)`);
      }

      // Determine timestamps to extract based on mode
      const timestamps = this.selectTimestamps(
        extractionMode,
        videoDuration,
        failureTimestamp,
        failureWindowSeconds,
        frameInterval
      );

      if (this.debug) {
        console.log(`[FrameExtractor] Will extract ${timestamps.length} frames at:`, timestamps);
      }

      // Extract frames at each timestamp
      // Extract frames in parallel (3-5x faster than sequential)
      const extractionPromises = timestamps.map(async (timestamp, index) => {
        try {
          const framePath = await this.extractFrameAt(videoPath, timestamp, index + 1);
          return {
            timestamp,
            frameNumber: index + 1,
            localPath: framePath
          };
        } catch (error) {
          if (this.debug) {
            console.warn(`[FrameExtractor] Failed to extract frame at ${timestamp}s:`, error);
          }
          return null;
        }
      });

      // Wait for all extractions to complete
      const extractionResults = await Promise.all(extractionPromises);
      const extractedFrames: ExtractedFrame[] = extractionResults.filter((f): f is ExtractedFrame => f !== null);

      if (this.debug) {
        console.error(`[FrameExtractor] ✅ Successfully extracted ${extractedFrames.length}/${timestamps.length} frames in parallel`);
      }

      // Process frames in parallel (resize, base64 encode, OCR)
      const processingPromises = extractedFrames.map(async (frame) => {
        try {
          return await this.processFrame(frame, includeOCR);
        } catch (error) {
          if (this.debug) {
            console.warn(`[FrameExtractor] Failed to process frame ${frame.frameNumber}:`, error);
          }
          
          // Return placeholder analysis on error
          return {
            timestamp: frame.timestamp,
            frameNumber: frame.frameNumber,
            framePath: frame.localPath,
            visualAnalysis: 'Frame processing failed',
            detectedElements: [],
            appState: 'Unknown',
            anomaliesDetected: []
          };
        }
      });

      // Wait for all processing to complete
      const frameAnalyses = await Promise.all(processingPromises);

      return frameAnalyses;

    } catch (error) {
      if (this.debug) {
        console.error('[FrameExtractor] Frame extraction error:', error);
      }
      throw new Error(`Failed to extract frames: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Select which timestamps to extract based on mode
   */
  private selectTimestamps(
    mode: 'failure_focused' | 'full_test' | 'smart',
    videoDuration: number,
    failureTimestamp?: number,
    failureWindowSeconds: number = 30,
    frameInterval: number = 5
  ): number[] {
    if (this.debug) {
      console.error(`[FrameExtractor] selectTimestamps: mode=${mode}, duration=${videoDuration}s, failureTime=${failureTimestamp}s, window=${failureWindowSeconds}s`);
    }
    
    const timestamps: number[] = [];

    switch (mode) {
      case 'failure_focused':
        // Extract ~10 frames around failure point
        if (failureTimestamp !== undefined) {
          const start = Math.max(0, failureTimestamp - failureWindowSeconds);
          const end = Math.min(videoDuration, failureTimestamp + 5);
          
          if (this.debug) {
            console.error(`[FrameExtractor] failure_focused: start=${start}s, end=${end}s`);
          }
          
          for (let t = start; t <= end; t += 3) {
            timestamps.push(Math.floor(t));
          }
        } else {
          // No failure timestamp, extract last 30 seconds
          const start = Math.max(0, videoDuration - 30);
          
          if (this.debug) {
            console.error(`[FrameExtractor] failure_focused (no failure time): extracting last 30s from ${start}s to ${videoDuration}s`);
          }
          
          for (let t = start; t <= videoDuration; t += 3) {
            timestamps.push(Math.floor(t));
          }
        }
        break;

      case 'full_test':
        // Extract ~30 frames evenly throughout test
        for (let t = 0; t <= videoDuration; t += frameInterval) {
          timestamps.push(Math.floor(t));
        }
        break;

      case 'smart':
        // Extract ~20 frames at strategic points
        // Start (2 frames)
        timestamps.push(0, 2);
        
        // Middle sections (12 frames)
        const middlePoints = 12;
        for (let i = 1; i <= middlePoints; i++) {
          const t = (videoDuration * i) / (middlePoints + 1);
          timestamps.push(Math.floor(t));
        }
        
        // Failure area if available (6 frames)
        if (failureTimestamp !== undefined) {
          const start = Math.max(0, failureTimestamp - 15);
          for (let i = 0; i < 6; i++) {
            const t = start + (i * 3);
            if (t <= videoDuration) {
              timestamps.push(Math.floor(t));
            }
          }
        } else {
          // End section (6 frames)
          const start = Math.max(0, videoDuration - 15);
          for (let t = start; t <= videoDuration; t += 3) {
            timestamps.push(Math.floor(t));
          }
        }
        break;
    }

    // Remove duplicates and sort
    const uniqueTimestamps = [...new Set(timestamps)].sort((a, b) => a - b);
    
    // Limit to max 30 frames
    return uniqueTimestamps.slice(0, 30);
  }

  /**
   * Extract a single frame at specific timestamp
   */
  private async extractFrameAt(
    videoPath: string,
    timestamp: number,
    frameNumber: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const filename = `frame-${frameNumber}-t${timestamp}.png`;
      const outputPath = path.join(this.tempDir, filename);

      let stderrOutput = '';

      const command = ffmpeg(videoPath)
        .seekInput(timestamp)
        .frames(1)
        .output(outputPath)
        .on('end', () => {
          // Validate that the file was actually created
          if (!fs.existsSync(outputPath)) {
            reject(new Error(`Frame file not created: ${outputPath}`));
            return;
          }

          const stats = fs.statSync(outputPath);
          if (stats.size === 0) {
            reject(new Error(`Frame file is empty: ${outputPath}`));
            return;
          }

          if (this.debug) {
            console.error(`[FrameExtractor] ✅ Extracted frame ${frameNumber} at ${timestamp}s (${stats.size} bytes)`);
          }
          resolve(outputPath);
        })
        .on('error', (err, stdout, stderr) => {
          stderrOutput = stderr || err.message;
          console.error(`[FrameExtractor] ❌ FFmpeg error at timestamp ${timestamp}s:`, stderrOutput);
          reject(new Error(`FFmpeg failed at ${timestamp}s: ${stderrOutput.substring(0, 500)}`));
        })
        .on('stderr', (stderrLine) => {
          if (this.debug) {
            console.error(`[FFmpeg stderr]: ${stderrLine}`);
          }
        });

      command.run();
    });
  }

  /**
   * Process frame: resize, encode to base64, and optionally run OCR
   */
  private async processFrame(
    frame: ExtractedFrame,
    includeOCR: boolean
  ): Promise<FrameAnalysis> {
    try {
      // Read frame file
      const imageBuffer = fs.readFileSync(frame.localPath);

      // Resize image to max 1024px width for Claude Vision (saves tokens)
      const resizedBuffer = await sharp(imageBuffer)
        .resize(1024, null, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .png()
        .toBuffer();

      // Encode to base64
      const base64 = resizedBuffer.toString('base64');

      // Extract OCR text if requested
      let ocrText: string | undefined;
      if (includeOCR) {
        try {
          ocrText = await this.extractTextFromImage(frame.localPath);
        } catch (ocrError) {
          if (this.debug) {
            console.warn(`[FrameExtractor] OCR failed for frame ${frame.frameNumber}:`, ocrError);
          }
          ocrText = undefined;
        }
      }

      return {
        timestamp: frame.timestamp,
        frameNumber: frame.frameNumber,
        framePath: frame.localPath, // Include the file path for file:// links
        imageBase64: base64,
        ocrText,
        visualAnalysis: '', // Will be filled by Claude Vision
        detectedElements: [],
        appState: '',
        anomaliesDetected: []
      };

    } catch (error) {
      throw new Error(`Failed to process frame: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Extract text from image using Tesseract OCR
   */
  private async extractTextFromImage(imagePath: string): Promise<string> {
    try {
      // Tesseract.js requires logger to be a function, not undefined
      const options: any = {};
      if (this.debug) {
        options.logger = (m: any) => console.error('[Tesseract]', m);
      }
      
      const result = await Tesseract.recognize(imagePath, 'eng', options);

      const text = result.data.text.trim();
      
      if (this.debug && text) {
        console.error(`[FrameExtractor] OCR extracted ${text.length} characters`);
      }

      return text;
    } catch (error) {
      throw new Error(`OCR failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Cleanup extracted frames
   */
  cleanupFrames(frameAnalyses: FrameAnalysis[]): void {
    // Note: localPath is not stored in FrameAnalysis, so we'll clean up entire temp directory
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        
        for (const file of files) {
          const filepath = path.join(this.tempDir, file);
          fs.unlinkSync(filepath);
        }

        if (this.debug) {
          console.log(`[FrameExtractor] Cleaned up ${files.length} frame(s)`);
        }
      }
    } catch (error) {
      if (this.debug) {
        console.warn('[FrameExtractor] Failed to cleanup frames:', error);
      }
    }
  }

  /**
   * Get temp directory path
   */
  getTempDir(): string {
    return this.tempDir;
  }
}

