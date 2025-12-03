#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const packagePath = join(process.cwd(), 'package.json');
const serverJsonPath = join(process.cwd(), 'server.json');
const changelogPath = join(process.cwd(), 'change-logs.md');

// Docker-related files that need version sync
const dockerFiles = {
  mcpCatalog: join(process.cwd(), 'mcp-catalog.yaml'),
  customCatalog: join(process.cwd(), 'custom-catalog.yaml'),
  catalogsYaml: join(process.cwd(), 'catalogs/mcp-zebrunner/catalog.yaml'),
};

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

// Check for --sync flag to only sync versions without incrementing
const syncOnly = process.argv.includes('--sync');

const currentVersion = packageJson.version;
const [major, minor, patch] = currentVersion.split('.');
const newPatch = parseInt(patch, 10) + 1;
const newVersion = syncOnly ? currentVersion : `${major}.${minor}.${newPatch}`;
const oldVersion = syncOnly ? currentVersion : packageJson.version;

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
      hasTestCaseByTitle: /get_test_case_by_title|title~=|title search/i.test(content),
      hasTestCaseByFilter: /get_test_case_by_filter|testsuite\.id|priority\.id|automationstate\.id/i.test(content),
      hasAutomationPriorities: /get_automation_priorities|getpriorities|automation.*priorities/i.test(content),
      hasReportingEnhancements: /reportingclient|bearer.*token|authentication|cache.*project/i.test(content),
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

    // Filter out files that are likely not part of the current feature
    // Focus on newly added files and recently modified files
    const relevantFiles = gitStatus.filter(f => {
      // Always include new files (untracked) - these are most likely the current feature
      if (f.status.includes('?')) return true;
      
      // For modified files, exclude some common files that change frequently
      if (f.status.includes('M')) {
        // Skip files that are commonly updated during version increments
        if (f.file === 'package.json' || f.file === 'change-logs.md') {
          return false;
        }
        // Skip README.md unless it's the only modified file (indicating documentation work)
        const modifiedFiles = gitStatus.filter(gf => gf.status.includes('M'));
        if (f.file === 'README.md' && modifiedFiles.length > 3) {
          return false;
        }
        return true;
      }
      
      return true;
    });

    // If we only have common modified files left, focus on the most recent/specific changes
    const newFiles = relevantFiles.filter(f => f.status.includes('?'));
    const modifiedFiles = relevantFiles.filter(f => f.status.includes('M'));
    
    // Prioritize new files over modified files for feature detection
    const filesToAnalyze = newFiles.length > 0 ? [...newFiles, ...modifiedFiles.slice(0, 2)] : modifiedFiles;

    // Analyze each relevant file
    const fileAnalyses = [];
    
    for (const fileInfo of filesToAnalyze) {
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

    // Check for major feature additions based on new files first
    const hasTestCaseByTitle = fileAnalyses.some(f => 
      f.analysis && f.analysis.hasTestCaseByTitle
    );
    const hasTestCaseByFilter = fileAnalyses.some(f => 
      f.analysis && f.analysis.hasTestCaseByFilter
    );
    const hasAutomationPriorities = fileAnalyses.some(f => 
      f.analysis && f.analysis.hasAutomationPriorities
    );
    const hasReportingEnhancements = fileAnalyses.some(f => 
      f.analysis && f.analysis.hasReportingEnhancements
    );
    const hasNewTests = fileAnalyses.some(f => 
      f.file.includes('test') && f.status.includes('?')
    );
    const hasTestCaseTools = fileAnalyses.some(f => 
      f.file.includes('test-case-tools') || f.file.includes('new-test-case')
    );
    const hasClickableLinks = fileAnalyses.some(f => 
      f.file.includes('clickable-links') || 
      (f.analysis && /clickable|link|url|href/i.test(f.file))
    );
    const hasDocumentationChanges = fileAnalyses.some(f => 
      f.file.endsWith('.md') && f.status.includes('?') && 
      (f.file.includes('GUIDE') || f.file.includes('INSTALL') || f.file.includes('DOC'))
    );
    const hasReadmeUpdates = fileAnalyses.some(f => 
      f.file === 'README.md' && f.status.includes('M')
    );
    const hasApiEnhancements = fileAnalyses.some(f => 
      (f.file.includes('api/') || f.file.includes('client')) && f.analysis && f.analysis.hasNewFunctions
    );
    const hasServerUpdates = fileAnalyses.some(f => 
      f.file.includes('server') && f.analysis && f.analysis.hasNewFunctions
    );
    
    // Only check for duplicate analyzer if it's in NEW files or primary focus
    const hasDuplicateAnalyzer = fileAnalyses.some(f => 
      f.file.includes('duplicate-analyzer') && f.status.includes('?')
    );
    const hasSemanticFeatures = fileAnalyses.some(f => 
      f.file.includes('semantic') && f.status.includes('?')
    );
    const hasNewUtilities = fileAnalyses.some(f => 
      f.file.includes('utils/') && f.status.includes('?') && !f.file.endsWith('.md')
    );
    const hasValidationFeatures = fileAnalyses.some(f => 
      f.analysis && f.analysis.hasValidation && f.file.includes('validator') && f.status.includes('?')
    );
    const hasTypeDefinitions = fileAnalyses.some(f => 
      f.analysis && f.analysis.hasTypeDefinitions && f.status.includes('?')
    );

    // Determine primary feature - prioritize new files/features
    if (hasTestCaseByTitle && hasTestCaseByFilter && hasAutomationPriorities) {
      primaryFeature = 'Added advanced test case search tools: title search, multi-criteria filtering, and automation priorities';
    } else if (hasTestCaseByTitle && hasTestCaseByFilter) {
      primaryFeature = 'Added new test case search tools: title search and advanced filtering capabilities';
    } else if (hasTestCaseByTitle) {
      primaryFeature = 'Added test case search by title functionality';
    } else if (hasTestCaseByFilter) {
      primaryFeature = 'Added advanced test case filtering by multiple criteria';
    } else if (hasAutomationPriorities) {
      primaryFeature = 'Added automation priorities management tools';
    } else if (hasReportingEnhancements && hasApiEnhancements) {
      primaryFeature = 'Enhanced reporting API with improved authentication and caching';
    } else if (hasReportingEnhancements) {
      primaryFeature = 'Improved reporting client with better error handling and caching';
    } else if (hasTestCaseTools || hasNewTests) {
      primaryFeature = 'Enhanced test case management tools and capabilities';
    } else if (hasClickableLinks) {
      primaryFeature = 'Added clickable links functionality for enhanced user experience';
    } else if (hasDocumentationChanges && hasReadmeUpdates) {
      primaryFeature = 'Enhanced documentation and user guides with improved navigation';
    } else if (hasDocumentationChanges) {
      primaryFeature = 'Added comprehensive installation and setup documentation';
    } else if (hasReadmeUpdates) {
      primaryFeature = 'Updated documentation and user guides';
    } else if (hasDuplicateAnalyzer && hasSemanticFeatures) {
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
    const errorHandlingFiles = fileAnalyses.filter(f => f.analysis && f.analysis.hasErrorHandling).length;
    const asyncFiles = fileAnalyses.filter(f => f.analysis && f.analysis.hasAsyncCode).length;
    const loggingFiles = fileAnalyses.filter(f => f.analysis && f.analysis.hasLogging).length;

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

      if (newCount > 0) {
        // Look at specific new files to generate better descriptions
        const newFileNames = newFiles.map(f => f.file);
        const docFiles = newFileNames.filter(name => name.endsWith('.md'));
        const codeFiles = newFileNames.filter(name => !name.endsWith('.md'));

        if (docFiles.length > 0 && codeFiles.length === 0) {
          finalDescription = `Enhanced documentation and user guides`;
        } else if (newFileNames.some(name => name.includes('guide') || name.includes('summary'))) {
          finalDescription = `Added documentation and implementation guides`;
        } else if (codeFiles.length > 0) {
          finalDescription = `Added ${newCount} new files with enhanced functionality`;
        } else {
          finalDescription = `Added ${newCount} new files with improvements`;
        }
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

// Escape special regex characters in a string
// This properly escapes all regex metacharacters including backslash
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Update version in YAML file using regex replacement
function updateYamlVersion(filePath, oldVer, newVer, forceSync = false) {
  if (!existsSync(filePath)) {
    return false;
  }
  
  try {
    let content = readFileSync(filePath, 'utf8');
    let updated = false;
    
    if (forceSync) {
      // In sync mode, replace any version pattern with the new version
      // Pattern: version: "X.Y.Z" or version: 'X.Y.Z' (at root level, not nested)
      const versionLinePattern = /^(version:\s*)["']?\d+\.\d+\.\d+["']?/gm;
      if (versionLinePattern.test(content)) {
        content = content.replace(versionLinePattern, `$1"${newVer}"`);
        updated = true;
      }
      
      // Also update nested version fields (like in custom-catalog.yaml)
      const nestedVersionPattern = /(^\s+version:\s*)["']?\d+\.\d+\.\d+["']?/gm;
      if (nestedVersionPattern.test(content)) {
        content = content.replace(nestedVersionPattern, `$1"${newVer}"`);
        updated = true;
      }
    } else {
      // Normal mode: only replace old version with new version
      // Use escapeRegExp to properly escape all regex metacharacters
      const escapedOldVer = escapeRegExp(oldVer);
      
      // Pattern 1: version: "X.Y.Z" (quoted)
      const quotedPattern = new RegExp(`(version:\\s*)["']${escapedOldVer}["']`, 'g');
      if (quotedPattern.test(content)) {
        content = content.replace(quotedPattern, `$1"${newVer}"`);
        updated = true;
      }
      
      // Pattern 2: version: X.Y.Z (unquoted)
      const unquotedPattern = new RegExp(`(version:\\s*)${escapedOldVer}(?=\\s|$|\\n)`, 'g');
      if (unquotedPattern.test(content)) {
        content = content.replace(unquotedPattern, `$1"${newVer}"`);
        updated = true;
      }
    }
    
    if (updated) {
      writeFileSync(filePath, content);
    }
    return updated;
  } catch (error) {
    console.warn(`Warning: Could not update version in ${filePath}: ${error.message}`);
    return false;
  }
}

// Update package.json version (skip if sync-only)
if (!syncOnly) {
  packageJson.version = newVersion;
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
}

// Update server.json version (skip if sync-only)
if (!syncOnly && existsSync(serverJsonPath)) {
  const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
  serverJson.version = newVersion;
  
  // Update version in packages array if it exists
  if (serverJson.packages && Array.isArray(serverJson.packages)) {
    serverJson.packages.forEach(pkg => {
      if (pkg.version) {
        pkg.version = newVersion;
      }
    });
  }
  
  writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n');
  console.log(`server.json version updated to ${newVersion}`);
}

// Update Docker-related files
console.log('\nSyncing Docker-related files...');
const dockerFilesUpdated = [];

for (const [name, filePath] of Object.entries(dockerFiles)) {
  // Use forceSync in sync-only mode to update any version to current
  if (updateYamlVersion(filePath, oldVersion, newVersion, syncOnly)) {
    const fileName = filePath.split('/').pop();
    dockerFilesUpdated.push(fileName);
    console.log(`  ✓ ${fileName} updated to ${newVersion}`);
  }
}

if (dockerFilesUpdated.length > 0) {
  console.log(`Docker files synced: ${dockerFilesUpdated.join(', ')}`);
} else {
  console.log('No Docker files found to update (or already in sync)');
}

// Generate and add changelog entry (skip if sync-only)
if (!syncOnly) {
  const changeDescription = generateChangelogEntry();
  updateChangelog(newVersion, changeDescription);
  console.log(`\nVersion incremented from ${oldVersion} to ${newVersion}`);
  console.log(`Changelog updated with: ${changeDescription}`);
} else {
  console.log(`\n✓ Docker files synced to version ${currentVersion}`);
}
