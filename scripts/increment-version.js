#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const packagePath = join(process.cwd(), 'package.json');
const changelogPath = join(process.cwd(), 'change-logs.md');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

const [major, minor, patch] = packageJson.version.split('.');
const newPatch = parseInt(patch, 10) + 1;
const newVersion = `${major}.${minor}.${newPatch}`;
const oldVersion = packageJson.version;

// Analyze file content to understand what changed
function analyzeFileChanges(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    
    const content = readFileSync(filePath, 'utf8').toLowerCase();
    const lines = content.split('\n');
    
    // Analyze content patterns
    const analysis = {
      hasNewFunctions: /function\s+\w+|const\s+\w+\s*=\s*\(|=>\s*{/.test(content),
      hasNewClasses: /class\s+\w+|interface\s+\w+/.test(content),
      hasNewImports: /import\s+.*from|require\s*\(/.test(content),
      hasErrorHandling: /try\s*{|catch\s*\(|throw\s+/.test(content),
      hasAsyncCode: /async\s+|await\s+|promise/i.test(content),
      hasApiCalls: /fetch\s*\(|axios|http|api/i.test(content),
      hasValidation: /validate|check|verify|assert/i.test(content),
      hasLogging: /console\.|log\(|debug|info|warn|error/i.test(content),
      hasTests: /test\s*\(|describe\s*\(|it\s*\(|expect\s*\(/i.test(content),
      hasDuplicateLogic: /duplicate|similar|match|compare/i.test(content),
      hasSemanticAnalysis: /semantic|nlp|analyze|similarity/i.test(content),
      hasTypeDefinitions: /interface|type\s+\w+\s*=|enum/i.test(content),
      lineCount: lines.length
    };
    
    return analysis;
  } catch (error) {
    return null;
  }
}

// Generate intelligent changelog entry based on actual changes
function generateChangelogEntry() {
  try {
    // Get modified and new files from git status
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' })
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const status = line.substring(0, 2).trim();
        const file = line.substring(3);
        return { status, file };
      });

    if (gitStatus.length === 0) {
      return 'Version update with minor improvements';
    }

    // Analyze each modified file
    const fileAnalyses = [];
    const modifiedFiles = gitStatus.filter(f => f.status.includes('M'));
    const newFiles = gitStatus.filter(f => f.status.includes('?'));
    
    for (const fileInfo of [...modifiedFiles, ...newFiles]) {
      const analysis = analyzeFileChanges(fileInfo.file);
      if (analysis) {
        fileAnalyses.push({
          file: fileInfo.file,
          status: fileInfo.status,
          analysis
        });
      }
    }

    // Generate smart description based on file analysis
    let descriptions = [];
    let primaryFeature = null;

    // Check for major feature additions
    const hasDuplicateAnalyzer = fileAnalyses.some(f => 
      f.file.includes('duplicate-analyzer') || f.analysis.hasDuplicateLogic
    );
    const hasSemanticFeatures = fileAnalyses.some(f => 
      f.file.includes('semantic') || f.analysis.hasSemanticAnalysis
    );
    const hasNewUtilities = fileAnalyses.some(f => 
      f.file.includes('utils/') && f.status.includes('?')
    );
    const hasApiEnhancements = fileAnalyses.some(f => 
      (f.file.includes('api/') || f.file.includes('client')) && f.analysis.hasNewFunctions
    );
    const hasServerUpdates = fileAnalyses.some(f => 
      f.file.includes('server') && f.analysis.hasNewFunctions
    );
    const hasNewTests = fileAnalyses.some(f => 
      f.file.includes('test') && (f.status.includes('?') || f.analysis.hasTests)
    );
    const hasValidationFeatures = fileAnalyses.some(f => 
      f.analysis.hasValidation && f.file.includes('validator')
    );
    const hasTypeDefinitions = fileAnalyses.some(f => 
      f.analysis.hasTypeDefinitions && f.status.includes('?')
    );

    // Determine primary feature
    if (hasDuplicateAnalyzer && hasSemanticFeatures) {
      primaryFeature = 'Advanced duplicate test case detection with semantic analysis';
    } else if (hasDuplicateAnalyzer) {
      primaryFeature = 'Enhanced duplicate test case analysis capabilities';
    } else if (hasSemanticFeatures) {
      primaryFeature = 'Added semantic analysis functionality';
    } else if (hasValidationFeatures) {
      primaryFeature = 'Improved test case validation features';
    } else if (hasApiEnhancements && hasServerUpdates) {
      primaryFeature = 'Enhanced API client and server functionality';
    } else if (hasApiEnhancements) {
      primaryFeature = 'Improved API client capabilities';
    } else if (hasServerUpdates) {
      primaryFeature = 'Enhanced server functionality';
    } else if (hasNewUtilities) {
      primaryFeature = 'Added new utility functions and tools';
    } else if (hasTypeDefinitions) {
      primaryFeature = 'Enhanced type definitions and interfaces';
    } else if (hasNewTests) {
      primaryFeature = 'Expanded test coverage and test utilities';
    }

    // Add secondary improvements
    const errorHandlingFiles = fileAnalyses.filter(f => f.analysis.hasErrorHandling).length;
    const asyncFiles = fileAnalyses.filter(f => f.analysis.hasAsyncCode).length;
    const loggingFiles = fileAnalyses.filter(f => f.analysis.hasLogging).length;
    
    if (errorHandlingFiles > 0) {
      descriptions.push('improved error handling');
    }
    if (asyncFiles > 0) {
      descriptions.push('enhanced async operations');
    }
    if (loggingFiles > 0) {
      descriptions.push('better logging');
    }

    // Build final description
    let finalDescription = primaryFeature || 'Code improvements and enhancements';
    
    if (descriptions.length > 0) {
      finalDescription += ` with ${descriptions.join(', ')}`;
    }

    // Fallback to file-based analysis if no specific features detected
    if (!primaryFeature) {
      const modifiedCount = modifiedFiles.length;
      const newCount = newFiles.length;
      
      if (newCount > modifiedCount) {
        finalDescription = `Added ${newCount} new files with enhanced functionality`;
      } else if (modifiedCount > 0) {
        finalDescription = `Updated ${modifiedCount} files with bug fixes and improvements`;
      }
    }

    return finalDescription;
    
  } catch (error) {
    console.warn('Could not analyze file changes, using default description');
    return 'Version update with improvements';
  }
}

// Create or update changelog
function updateChangelog(version, description) {
  const newEntry = `## v${version}\n- ${description}\n\n`;
  
  if (!existsSync(changelogPath)) {
    // Create new changelog file
    const initialContent = `# Change Logs\n\nThis file tracks version changes and improvements to the MCP Zebrunner project.\n\n${newEntry}`;
    writeFileSync(changelogPath, initialContent);
  } else {
    // Read existing changelog and prepend new entry
    const existingContent = readFileSync(changelogPath, 'utf8');
    const lines = existingContent.split('\n');
    
    // Find where to insert the new entry (after the header)
    let insertIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '' && i > 0) {
        insertIndex = i + 1;
        break;
      }
    }
    
    // Insert new entry
    lines.splice(insertIndex, 0, ...newEntry.split('\n'));
    writeFileSync(changelogPath, lines.join('\n'));
  }
}

// Update package.json version
packageJson.version = newVersion;
writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

// Generate and add changelog entry
const changeDescription = generateChangelogEntry();
updateChangelog(newVersion, changeDescription);

console.log(`Version incremented from ${oldVersion} to ${newVersion}`);
console.log(`Changelog updated with: ${changeDescription}`);