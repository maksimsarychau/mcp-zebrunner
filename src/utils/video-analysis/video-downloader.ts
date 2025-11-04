import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ZebrunnerReportingClient } from '../../api/reporting-client.js';
import { TestSessionVideo, VideoDownloadResult } from './types.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';

// Set FFmpeg and FFprobe paths
ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

/**
 * VideoDownloader class
 * Handles fetching test session video URLs and downloading videos
 */
export class VideoDownloader {
  private tempDir: string;

  constructor(
    private reportingClient: ZebrunnerReportingClient,
    private debug: boolean = false
  ) {
    // Use environment variable or default temp directory
    this.tempDir = process.env.VIDEO_DOWNLOAD_DIR || 
      path.join(os.tmpdir(), 'mcp-zebrunner', 'videos');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Get video URL from test sessions artifacts
   * Fetches test sessions and extracts video URL from the last session
   */
  async getVideoUrlFromTestSessions(
    testId: number,
    testRunId: number,
    projectId: number
  ): Promise<TestSessionVideo | null> {
    try {
      if (this.debug) {
        console.log(`[VideoDownloader] Fetching test sessions for test ${testId}, launch ${testRunId}`);
      }

      // Fetch test sessions for this specific test
      const sessionsResponse = await this.reportingClient.getTestSessionsForTest(
        testRunId,
        testId,
        projectId
      );

      if (!sessionsResponse.items || sessionsResponse.items.length === 0) {
        if (this.debug) {
          console.log('[VideoDownloader] No test sessions found');
        }
        return null;
      }

      if (this.debug) {
        console.log(`[VideoDownloader] Found ${sessionsResponse.items.length} test session(s)`);
      }

      // Get the LAST session (most recent execution)
      const lastSession = sessionsResponse.items[sessionsResponse.items.length - 1];

      if (this.debug) {
        console.log(`[VideoDownloader] Using last session: ${lastSession.sessionId}`);
      }

      // Check if video artifact exists
      const videoArtifact = lastSession.artifactReferences?.find(
        (artifact: any) => artifact.name === 'Video'
      );

      if (!videoArtifact) {
        if (this.debug) {
          console.log('[VideoDownloader] No video artifact found in session');
        }
        return null;
      }

      // Construct full video URL
      const baseUrl = this.reportingClient['config'].baseUrl.replace(/\/+$/, '');
      const videoUrl = `${baseUrl}/${videoArtifact.value}`;

      if (this.debug) {
        console.log(`[VideoDownloader] Video URL constructed: ${videoUrl}`);
      }

      return {
        sessionId: lastSession.sessionId || lastSession.id?.toString() || 'unknown',
        videoUrl,
        projectId,
        sessionStart: lastSession.startedAt ? String(lastSession.startedAt) : undefined,
        sessionEnd: lastSession.endedAt ? String(lastSession.endedAt) : undefined,
        platformName: lastSession.platformName || undefined,
        deviceName: lastSession.deviceName || undefined,
        status: lastSession.status
      };

    } catch (error) {
      if (this.debug) {
        console.error('[VideoDownloader] Error fetching test sessions:', error);
      }
      throw new Error(`Failed to fetch test sessions: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Download video file from Zebrunner with authentication
   */
  async downloadVideo(
    videoUrl: string,
    testId: number,
    sessionId: string
  ): Promise<VideoDownloadResult> {
    try {
      if (this.debug) {
        console.log(`[VideoDownloader] Downloading video from: ${videoUrl}`);
      }

      // Get authenticated bearer token
      const bearerToken = await this.reportingClient['getBearerToken']();

      // Download video using axios (from reportingClient's http instance)
      const axios = this.reportingClient['http'];
      
      const response = await axios.get(videoUrl, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`
        },
        responseType: 'stream',
        maxRedirects: 5, // Handle redirects
        timeout: 300000 // 5 minutes timeout
      });

      if (!response.data) {
        return {
          success: false,
          error: 'Empty response from video URL'
        };
      }

      // Save to temporary location
      const filename = `test-${testId}-session-${sessionId}.mp4`;
      const tempPath = path.join(this.tempDir, filename);

      if (this.debug) {
        console.log(`[VideoDownloader] Saving video to: ${tempPath}`);
      }

      // Create write stream
      const writer = fs.createWriteStream(tempPath);

      // Pipe response to file
      response.data.pipe(writer);

      // Wait for download to complete
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      if (this.debug) {
        console.log('[VideoDownloader] Video download complete');
      }

      // Get file size
      const stats = fs.statSync(tempPath);
      const fileSize = stats.size;

      if (fileSize === 0) {
        fs.unlinkSync(tempPath);
        return {
          success: false,
          error: 'Downloaded video file is empty'
        };
      }

      if (this.debug) {
        console.log(`[VideoDownloader] Video file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
      }

      // Get video metadata using ffprobe
      const metadata = await this.getVideoMetadata(tempPath);

      return {
        success: true,
        localPath: tempPath,
        duration: metadata.duration,
        resolution: metadata.resolution,
        sessionId,
        fileSize
      };

    } catch (error) {
      if (this.debug) {
        console.error('[VideoDownloader] Error downloading video:', error);
      }
      return {
        success: false,
        error: `Failed to download video: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Extract video metadata using ffprobe
   */
  private async getVideoMetadata(videoPath: string): Promise<{
    duration: number;
    resolution: string;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          if (this.debug) {
            console.error('[VideoDownloader] ffprobe error:', err);
          }
          reject(new Error(`Failed to extract video metadata: ${err.message}`));
          return;
        }

        try {
          const videoStream = metadata.streams.find(s => s.codec_type === 'video');
          
          if (!videoStream) {
            reject(new Error('No video stream found in file'));
            return;
          }

          const duration = metadata.format.duration || 0;
          const width = videoStream.width || 0;
          const height = videoStream.height || 0;
          const resolution = `${width}x${height}`;

          if (this.debug) {
            console.log(`[VideoDownloader] Video metadata: ${duration}s, ${resolution}`);
          }

          resolve({ duration, resolution });
        } catch (parseError) {
          reject(new Error(`Failed to parse video metadata: ${parseError instanceof Error ? parseError.message : parseError}`));
        }
      });
    });
  }

  /**
   * Cleanup temporary video file
   */
  cleanupVideo(videoPath: string): void {
    try {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
        if (this.debug) {
          console.log(`[VideoDownloader] Cleaned up video: ${videoPath}`);
        }
      }
    } catch (error) {
      if (this.debug) {
        console.warn(`[VideoDownloader] Failed to cleanup video: ${error}`);
      }
    }
  }

  /**
   * Cleanup old videos from temp directory (older than maxAgeMs)
   */
  cleanupOldVideos(maxAgeMs: number = 3600000): number {
    if (!fs.existsSync(this.tempDir)) {
      return 0;
    }

    let deletedCount = 0;
    const now = Date.now();

    try {
      const files = fs.readdirSync(this.tempDir);

      for (const file of files) {
        const filepath = path.join(this.tempDir, file);
        const stats = fs.statSync(filepath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs) {
          fs.unlinkSync(filepath);
          deletedCount++;
        }
      }

      if (this.debug && deletedCount > 0) {
        console.log(`[VideoDownloader] Cleaned up ${deletedCount} old video(s)`);
      }
    } catch (error) {
      if (this.debug) {
        console.warn('[VideoDownloader] Failed to cleanup old videos:', error);
      }
    }

    return deletedCount;
  }

  /**
   * Get temp directory path
   */
  getTempDir(): string {
    return this.tempDir;
  }
}


