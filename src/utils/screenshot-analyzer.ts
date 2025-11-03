import sharp from 'sharp';
import { createWorker, Worker } from 'tesseract.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Screenshot analysis utilities
 * Provides image metadata extraction and optional OCR
 */

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  orientation: 'portrait' | 'landscape' | 'square';
  aspectRatio: string;
  hasAlpha: boolean;
  colorSpace?: string;
}

export interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  lines: string[];
}

export interface ScreenshotAnalysis {
  metadata: ImageMetadata;
  ocrText?: OCRResult;
  deviceInfo?: {
    detectedDevice?: string;
    statusBarVisible?: boolean;
    navigationBarVisible?: boolean;
  };
  uiElements?: {
    hasLoadingIndicator?: boolean;
    hasErrorDialog?: boolean;
    hasEmptyState?: boolean;
    hasNavigationBar?: boolean;
  };
}

/**
 * Get image metadata using sharp
 */
export async function getImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const stats = await image.stats();
    
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    
    let orientation: 'portrait' | 'landscape' | 'square' = 'square';
    if (width > height) orientation = 'landscape';
    else if (height > width) orientation = 'portrait';
    
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    const aspectRatio = `${width / divisor}:${height / divisor}`;
    
    return {
      width,
      height,
      format: metadata.format || 'unknown',
      size: buffer.length,
      orientation,
      aspectRatio,
      hasAlpha: metadata.hasAlpha || false,
      colorSpace: metadata.space
    };
  } catch (error) {
    throw new Error(`Failed to extract image metadata: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Extract text from image using OCR (Tesseract.js)
 * This is optional and may take several seconds
 */
export async function extractTextOCR(
  buffer: Buffer,
  options: {
    lang?: string;
    psm?: number;
  } = {}
): Promise<OCRResult> {
  const { lang = 'eng', psm = 3 } = options;
  
  let worker: Worker | null = null;
  try {
    worker = await createWorker(lang, 1, {
      logger: () => {}, // Suppress logs
    });
    
    await worker.setParameters({
      tessedit_pageseg_mode: psm as any,
    });
    
    const { data } = await worker.recognize(buffer);
    
    const words = data.words.map(word => ({
      text: word.text,
      confidence: word.confidence,
      bbox: {
        x: word.bbox.x0,
        y: word.bbox.y0,
        width: word.bbox.x1 - word.bbox.x0,
        height: word.bbox.y1 - word.bbox.y0
      }
    }));
    
    const lines = data.lines.map(line => line.text);
    
    return {
      text: data.text.trim(),
      confidence: data.confidence,
      words,
      lines
    };
  } catch (error) {
    throw new Error(`OCR extraction failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}

/**
 * Detect basic UI elements from text content
 */
export function detectUIElements(text: string): {
  hasLoadingIndicator: boolean;
  hasErrorDialog: boolean;
  hasEmptyState: boolean;
  hasNavigationBar: boolean;
  detectedElements: string[];
} {
  const lowerText = text.toLowerCase();
  const detectedElements: string[] = [];
  
  // Loading indicators
  const hasLoadingIndicator = (
    lowerText.includes('loading') ||
    lowerText.includes('please wait') ||
    lowerText.includes('processing')
  );
  if (hasLoadingIndicator) detectedElements.push('Loading Indicator');
  
  // Error dialogs
  const hasErrorDialog = (
    lowerText.includes('error') ||
    lowerText.includes('failed') ||
    lowerText.includes('try again') ||
    lowerText.includes('something went wrong')
  );
  if (hasErrorDialog) detectedElements.push('Error Dialog');
  
  // Empty state
  const hasEmptyState = (
    lowerText.includes('no data') ||
    lowerText.includes('nothing to show') ||
    lowerText.includes('start tracking') ||
    lowerText.includes('get started') ||
    lowerText.includes('no items') ||
    lowerText.includes('empty')
  );
  if (hasEmptyState) detectedElements.push('Empty State');
  
  // Navigation elements
  const hasNavigationBar = (
    lowerText.includes('home') ||
    lowerText.includes('settings') ||
    lowerText.includes('profile') ||
    lowerText.includes('back') ||
    lowerText.includes('menu')
  );
  if (hasNavigationBar) detectedElements.push('Navigation Bar');
  
  return {
    hasLoadingIndicator,
    hasErrorDialog,
    hasEmptyState,
    hasNavigationBar,
    detectedElements
  };
}

/**
 * Detect device information from image dimensions
 */
export function detectDeviceInfo(metadata: ImageMetadata): {
  detectedDevice?: string;
  confidence: 'high' | 'medium' | 'low';
  deviceType: 'phone' | 'tablet' | 'unknown';
} {
  const { width, height, orientation } = metadata;
  const largerDimension = Math.max(width, height);
  const smallerDimension = Math.min(width, height);
  
  // Common device resolutions
  const devices: Array<{name: string, width: number, height: number, tolerance: number}> = [
    { name: 'iPhone 15 Pro Max', width: 1290, height: 2796, tolerance: 10 },
    { name: 'iPhone 15 Pro', width: 1179, height: 2556, tolerance: 10 },
    { name: 'Galaxy S24', width: 1080, height: 2340, tolerance: 10 },
    { name: 'Galaxy S23', width: 1080, height: 2340, tolerance: 10 },
    { name: 'Pixel 8 Pro', width: 1008, height: 2244, tolerance: 10 },
    { name: 'iPad Pro 12.9"', width: 2048, height: 2732, tolerance: 10 },
  ];
  
  let detectedDevice: string | undefined;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  
  for (const device of devices) {
    const matchWidth = Math.abs(largerDimension - Math.max(device.width, device.height)) <= device.tolerance;
    const matchHeight = Math.abs(smallerDimension - Math.min(device.width, device.height)) <= device.tolerance;
    
    if (matchWidth && matchHeight) {
      detectedDevice = device.name;
      confidence = 'high';
      break;
    } else if (matchWidth || matchHeight) {
      detectedDevice = device.name + ' (partial match)';
      confidence = 'medium';
    }
  }
  
  // Determine device type based on dimensions
  let deviceType: 'phone' | 'tablet' | 'unknown' = 'unknown';
  if (largerDimension < 1400) {
    deviceType = 'phone';
  } else if (largerDimension >= 2000) {
    deviceType = 'tablet';
  }
  
  return {
    detectedDevice,
    confidence,
    deviceType
  };
}

/**
 * Perform complete screenshot analysis
 */
export async function analyzeScreenshot(
  buffer: Buffer,
  options: {
    enableOCR?: boolean;
    ocrLanguage?: string;
  } = {}
): Promise<ScreenshotAnalysis> {
  const { enableOCR = false, ocrLanguage = 'eng' } = options;
  
  // Extract metadata
  const metadata = await getImageMetadata(buffer);
  
  // Optional OCR
  let ocrResult: OCRResult | undefined;
  let uiElements: ScreenshotAnalysis['uiElements'] | undefined;
  
  if (enableOCR) {
    try {
      ocrResult = await extractTextOCR(buffer, { lang: ocrLanguage });
      const uiDetection = detectUIElements(ocrResult.text);
      uiElements = {
        hasLoadingIndicator: uiDetection.hasLoadingIndicator,
        hasErrorDialog: uiDetection.hasErrorDialog,
        hasEmptyState: uiDetection.hasEmptyState,
        hasNavigationBar: uiDetection.hasNavigationBar
      };
    } catch (error) {
      console.warn('OCR failed, continuing without text extraction:', error);
    }
  }
  
  // Device detection
  const deviceInfo = detectDeviceInfo(metadata);
  
  return {
    metadata,
    ocrText: ocrResult,
    deviceInfo: {
      detectedDevice: deviceInfo.detectedDevice,
      statusBarVisible: metadata.height > 2000, // Rough heuristic
      navigationBarVisible: uiElements?.hasNavigationBar
    },
    uiElements
  };
}

/**
 * Save screenshot to temporary directory
 */
export async function saveScreenshotToTemp(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const tempDir = process.env.SCREENSHOT_DOWNLOAD_DIR || path.join(os.tmpdir(), 'mcp-zebrunner', 'screenshots');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const filepath = path.join(tempDir, filename);
  await fs.promises.writeFile(filepath, buffer);
  
  return filepath;
}

/**
 * Cleanup old screenshots from temp directory
 */
export function cleanupOldScreenshots(maxAgeMs: number = 3600000): number {
  const tempDir = process.env.SCREENSHOT_DOWNLOAD_DIR || path.join(os.tmpdir(), 'mcp-zebrunner', 'screenshots');
  
  if (!fs.existsSync(tempDir)) {
    return 0;
  }
  
  let deletedCount = 0;
  const now = Date.now();
  
  try {
    const files = fs.readdirSync(tempDir);
    
    for (const file of files) {
      const filepath = path.join(tempDir, file);
      const stats = fs.statSync(filepath);
      const age = now - stats.mtimeMs;
      
      if (age > maxAgeMs) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    }
  } catch (error) {
    console.warn('Failed to cleanup old screenshots:', error);
  }
  
  return deletedCount;
}

/**
 * Convert buffer to base64 for MCP image passing
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/**
 * Detect image format from buffer
 */
export function detectImageFormat(buffer: Buffer): 'png' | 'jpeg' | 'jpg' | 'webp' | 'gif' | 'unknown' {
  // Check magic bytes
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'png';
  } else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpeg';
  } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // RIFF header, check for WEBP
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'webp';
    }
  } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'gif';
  }
  
  return 'unknown';
}

/**
 * Get total size of screenshot cache directory
 */
export function getCacheSize(): { totalSize: number; fileCount: number } {
  const tempDir = process.env.SCREENSHOT_DOWNLOAD_DIR || path.join(os.tmpdir(), 'mcp-zebrunner', 'screenshots');
  
  if (!fs.existsSync(tempDir)) {
    return { totalSize: 0, fileCount: 0 };
  }

  let totalSize = 0;
  let fileCount = 0;

  const files = fs.readdirSync(tempDir);
  
  for (const file of files) {
    try {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
      fileCount++;
    } catch (error) {
      console.error(`Failed to stat file ${file}:`, error);
    }
  }

  return { totalSize, fileCount };
}

/**
 * Clear all screenshots from cache
 */
export function clearAllScreenshots(): number {
  const tempDir = process.env.SCREENSHOT_DOWNLOAD_DIR || path.join(os.tmpdir(), 'mcp-zebrunner', 'screenshots');
  
  if (!fs.existsSync(tempDir)) {
    return 0;
  }

  let cleared = 0;
  const files = fs.readdirSync(tempDir);
  
  for (const file of files) {
    try {
      const filePath = path.join(tempDir, file);
      fs.unlinkSync(filePath);
      cleared++;
    } catch (error) {
      console.error(`Failed to delete file ${file}:`, error);
    }
  }

  return cleared;
}

// Auto cleanup on module load (removes screenshots older than 1 hour)
try {
  const cleaned = cleanupOldScreenshots(3600000); // 1 hour
  if (cleaned > 0) {
    console.log(`[Screenshot Cleanup] Removed ${cleaned} old screenshot(s)`);
  }
} catch (error) {
  console.error('[Screenshot Cleanup] Failed:', error);
}

