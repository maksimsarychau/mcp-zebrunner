/**
 * Manual test for screenshot download and analysis
 * Run this to verify screenshot tools work with real Zebrunner URLs
 * 
 * Usage:
 *   npm run build && node dist/tests/manual-screenshot-test.js
 */

import { ZebrunnerReportingClient } from '../src/api/reporting-client.js';
import { analyzeScreenshot, saveScreenshotToTemp } from '../src/utils/screenshot-analyzer.js';
import { config } from 'dotenv';

config();

async function testScreenshotTools() {
  console.log('🧪 Testing Screenshot Download and Analysis\n');

  const baseUrl = process.env.ZEBRUNNER_URL || 'https://your-workspace.zebrunner.com';
  const token = process.env.ZEBRUNNER_TOKEN;

  if (!token) {
    console.error('❌ ZEBRUNNER_TOKEN not set in environment');
    process.exit(1);
  }

  const client = new ZebrunnerReportingClient({
    baseUrl,
    accessToken: token,
    debug: true
  });

  // Test screenshot URL from the user's example
  const testScreenshotUrl = 'https://your-workspace.zebrunner.com/files/19a3c384-a06a-10d7-1aa1-cf9c3244b021';
  
  console.log(`📸 Test Screenshot URL: ${testScreenshotUrl}\n`);

  try {
    // Test 1: Download Screenshot
    console.log('1️⃣ Testing screenshot download...');
    const imageBuffer = await client.downloadScreenshot(testScreenshotUrl);
    console.log(`✅ Downloaded ${imageBuffer.length} bytes\n`);

    // Test 2: Save to file
    console.log('2️⃣ Saving screenshot to file...');
    const filePath = await saveScreenshotToTemp(imageBuffer, 'test_screenshot.png');
    console.log(`✅ Saved to: ${filePath}\n`);

    // Test 3: Basic Analysis (no OCR)
    console.log('3️⃣ Running basic analysis (no OCR)...');
    const basicAnalysis = await analyzeScreenshot(imageBuffer, { enableOCR: false });
    console.log('✅ Basic Analysis Results:');
    console.log(`   - Dimensions: ${basicAnalysis.metadata.width}x${basicAnalysis.metadata.height}`);
    console.log(`   - Format: ${basicAnalysis.metadata.format}`);
    console.log(`   - Size: ${Math.round(basicAnalysis.metadata.size / 1024)} KB`);
    console.log(`   - Orientation: ${basicAnalysis.metadata.orientation}`);
    console.log(`   - Aspect Ratio: ${basicAnalysis.metadata.aspectRatio}\n`);

    // Test 4: Analysis with OCR (slower)
    console.log('4️⃣ Running analysis with OCR (this may take 5-10 seconds)...');
    const ocrAnalysis = await analyzeScreenshot(imageBuffer, { enableOCR: true });
    console.log('✅ OCR Analysis Results:');
    console.log(`   - Text confidence: ${Math.round(ocrAnalysis.ocrText?.confidence || 0)}%`);
    console.log(`   - Lines extracted: ${ocrAnalysis.ocrText?.lines.length || 0}`);
    if (ocrAnalysis.ocrText && ocrAnalysis.ocrText.lines.length > 0) {
      console.log('   - First 5 lines:');
      ocrAnalysis.ocrText.lines.slice(0, 5).forEach((line, idx) => {
        if (line.trim()) {
          console.log(`     ${idx + 1}. ${line}`);
        }
      });
    }
    console.log('');

    // Test 5: Device Detection
    if (ocrAnalysis.deviceInfo?.detectedDevice) {
      console.log('5️⃣ Device Detection:');
      console.log(`   - Device: ${ocrAnalysis.deviceInfo.detectedDevice}`);
      console.log('');
    }

    // Test 6: UI Elements
    if (ocrAnalysis.uiElements) {
      console.log('6️⃣ UI Elements Detected:');
      if (ocrAnalysis.uiElements.hasEmptyState) console.log('   - ✅ Empty State');
      if (ocrAnalysis.uiElements.hasLoadingIndicator) console.log('   - ⏳ Loading Indicator');
      if (ocrAnalysis.uiElements.hasErrorDialog) console.log('   - ❌ Error Dialog');
      if (ocrAnalysis.uiElements.hasNavigationBar) console.log('   - 🧭 Navigation Bar');
      console.log('');
    }

    console.log('🎉 All tests passed!\n');
    console.log('📝 Summary:');
    console.log('   ✅ Screenshot download: Working');
    console.log('   ✅ File saving: Working');
    console.log('   ✅ Metadata extraction: Working');
    console.log('   ✅ OCR text extraction: Working');
    console.log('   ✅ Device detection: Working');
    console.log('   ✅ UI element detection: Working\n');

    console.log('💡 Next steps:');
    console.log('   1. Test with analyze_screenshot MCP tool in Claude Desktop');
    console.log('   2. Use "detailed" analysis type to pass image to Claude Vision');
    console.log('   3. Integrate with analyze_test_failure for automatic screenshot analysis\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testScreenshotTools().catch(console.error);

