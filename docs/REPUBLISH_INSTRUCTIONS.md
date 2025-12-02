# Republish Instructions for Version 5.12.0

This document contains step-by-step instructions for republishing the MCP Zebrunner package to npm and the MCP Registry.

---

## 📋 Pre-Publish Checklist

Before republishing, verify:

- ✅ Version updated to **5.12.0** in:
  - `package.json`
  - `server.json` (both root and packages array)
  - `MCP_NPM_INSTALLATION_GUIDE.md`
- ✅ Changelog updated with new version entry
- ✅ README.md updated with link to MCP NPM Installation Guide
- ✅ All changes committed to git
- ✅ Build succeeds without errors

---

## 🔨 Step 1: Build the Project

Build the TypeScript project to ensure everything compiles correctly:

```bash
npm run build
```

**Expected output:**
- No TypeScript compilation errors
- `dist/` folder created with compiled JavaScript files

**Troubleshooting:**
- If build fails, fix TypeScript errors before proceeding
- Run `npm run lint` to check for issues

---

## 📦 Step 2: Publish to npm

### 2.1 Verify npm Login

Check that you're logged into npm:

```bash
npm whoami
```

If not logged in:

```bash
npm login
```

### 2.2 Publish to npm

Publish the package to npm registry:

```bash
npm publish --access public
```

**Expected output:**
```
npm notice 📦  mcp-zebrunner@5.12.0
npm notice === Tarball Details ===
npm notice name:          mcp-zebrunner
npm notice version:       5.12.0
...
+ mcp-zebrunner@5.12.0
```

### 2.3 Verify npm Publication

Check that the package is live on npm:

```bash
# View package details
npm view mcp-zebrunner

# Check version
npm view mcp-zebrunner version

# Or visit in browser
open https://www.npmjs.com/package/mcp-zebrunner
```

---

## 🌐 Step 3: Publish to MCP Registry

### 3.1 Authenticate with MCP Registry

Login to the MCP registry using GitHub:

```bash
mcp-publisher login github
```

**Follow the prompts:**
1. Visit the GitHub device code URL
2. Enter the provided code
3. Authorize the application
4. Wait for "Successfully authenticated!" message

### 3.2 Publish to MCP Registry

Publish the server configuration to the MCP registry:

```bash
mcp-publisher publish
```

**Expected output:**
```
Publishing to https://registry.modelcontextprotocol.io...
✓ Successfully published
✓ Server io.github.maksimsarychau/mcp-zebrunner version 5.12.0
```

### 3.3 Verify MCP Registry Publication

Verify the server is available in the registry:

```bash
curl "https://registry.modelcontextprotocol.io/v0/servers?search=zebrunner" | jq '.'
```

**Expected output:**
- Server status: `"active"`
- Version: `"5.12.0"`
- Published timestamp updated

---

## ✅ Step 4: Post-Publication Verification

### 4.1 Test npm Installation

Test that users can install the package:

```bash
# Create a test directory
mkdir /tmp/test-mcp-zebrunner
cd /tmp/test-mcp-zebrunner

# Install globally
npm install -g mcp-zebrunner

# Verify installation
npm list -g mcp-zebrunner

# Check the installed version
node -e "console.log(require('mcp-zebrunner/package.json').version)"

# Clean up
cd ~
rm -rf /tmp/test-mcp-zebrunner
```

### 4.2 Test Server Execution

Test that the server runs without errors:

```bash
# Set test environment variables
export ZEBRUNNER_URL="https://test.zebrunner.com"
export ZEBRUNNER_LOGIN="test"
export ZEBRUNNER_TOKEN="test-token"

# Run the server (should start without crashing)
node $(npm root -g)/mcp-zebrunner/dist/server.js
```

Press `Ctrl+C` to stop the server.

### 4.3 Verify Web Presence

Check that all web pages are updated:

1. **npm Package Page**
   - https://www.npmjs.com/package/mcp-zebrunner
   - Verify version shows 5.12.0

2. **GitHub Repository**
   - https://github.com/maksimsarychau/mcp-zebrunner
   - Verify README.md has the new installation guide link

3. **MCP Registry**
   - Search: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=zebrunner"`
   - Verify version is 5.12.0

---

## 🏷️ Step 5: Git Tag and Release (Recommended)

Create a git tag for this version:

```bash
# Tag the current commit
git tag -a v5.12.0 -m "Release v5.12.0: MCP Registry publication and comprehensive installation guide"

# Push the tag to GitHub
git push origin v5.12.0

# Push all changes
git push origin feature/mcp-publisher-setup
```

**Create a GitHub Release:**

1. Go to https://github.com/maksimsarychau/mcp-zebrunner/releases
2. Click "Draft a new release"
3. Select tag: `v5.12.0`
4. Release title: `v5.12.0 - MCP Registry Publication`
5. Description:
   ```markdown
   ## 🎉 What's New
   
   - **Published to MCP Registry** - Now discoverable at https://registry.modelcontextprotocol.io
   - **Published to npm** - Install with `npm install -g mcp-zebrunner`
   - **Comprehensive Installation Guide** - Setup instructions for Claude Desktop, Cursor, IntelliJ IDEA, and ChatGPT Desktop
   
   ## 📦 Installation
   
   ```bash
   npm install -g mcp-zebrunner
   ```
   
   See the [MCP NPM Installation Guide](MCP_NPM_INSTALLATION_GUIDE.md) for detailed setup instructions.
   
   ## 🔗 Links
   
   - npm Package: https://www.npmjs.com/package/mcp-zebrunner
   - MCP Registry: https://registry.modelcontextprotocol.io/v0/servers?search=zebrunner
   - Documentation: https://github.com/maksimsarychau/mcp-zebrunner
   ```
6. Click "Publish release"

---

## 🔄 For Future Version Updates

When releasing future versions, use the updated increment script:

```bash
# This will now update both package.json and server.json
npm run increment

# Or manually
node scripts/increment-version.js
```

The script now automatically:
- Increments version in package.json
- Updates version in server.json (root and packages array)
- Generates intelligent changelog entries
- Keeps everything in sync

Then follow steps 1-5 above to republish.

---

## 🐛 Troubleshooting

### npm Publish Fails with 403 Error

**Problem:** Not authorized to publish.

**Solution:**
```bash
npm login
npm whoami  # Verify you're logged in
npm publish --access public
```

### npm Publish Fails with "Version already exists"

**Problem:** Version 5.12.0 already published.

**Solution:**
```bash
# Increment patch version
npm version patch

# Update server.json manually to match new version
# Then republish
npm run build && npm publish --access public
```

### MCP Registry Authentication Expired

**Problem:** Token expired during publish.

**Solution:**
```bash
mcp-publisher login github
mcp-publisher publish
```

### MCP Registry Says "NPM package not found"

**Problem:** npm package hasn't propagated yet.

**Solution:**
- Wait 1-2 minutes for npm to update
- Verify package exists: `npm view mcp-zebrunner`
- Then retry: `mcp-publisher publish`

---

## 📝 Notes

- **npm publication is required before MCP registry** - The MCP registry validates that the npm package exists
- **Authentication tokens expire** - Re-authenticate if you get 401 errors
- **Version numbers must match** - Ensure package.json and server.json versions are identical
- **Build before publish** - Always run `npm run build` before publishing

---

## ✅ Success Criteria

You know the publication was successful when:

- ✅ npm shows the new version: `npm view mcp-zebrunner version` returns `5.12.0`
- ✅ MCP registry search returns status `"active"` with version `5.12.0`
- ✅ Users can install: `npm install -g mcp-zebrunner` succeeds
- ✅ Server runs without errors
- ✅ GitHub tag and release created

---

**Last Updated:** December 2, 2025  
**Version:** 5.12.0
