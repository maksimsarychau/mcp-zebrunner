# MCP Zebrunner - NPM Installation & Configuration Guide

This guide walks you through installing and configuring the **Zebrunner MCP Server** for various AI clients including Claude Desktop, Cursor, IntelliJ IDEA, and ChatGPT Desktop.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation Methods](#installation-methods)
3. [Required Configuration](#required-configuration)
4. [Optional Configuration](#optional-configuration)
5. [Client Configuration](#client-configuration)
   - [Claude Desktop](#claude-desktop)
   - [Cursor](#cursor)
   - [IntelliJ IDEA](#intellij-idea)
   - [ChatGPT Desktop](#chatgpt-desktop)
6. [Verification & Testing](#verification--testing)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before installing, ensure you have:
- **Node.js** (v18 or higher) installed
- **npm** package manager
- Access to a **Zebrunner instance**
- Zebrunner **login credentials** and **API token**

---

## Installation Methods

### Method 1: Global Installation (Recommended)

Install the package globally to use it across all projects:

```bash
npm install -g mcp-zebrunner
```

**Location after installation:**
- macOS/Linux: `/usr/local/lib/node_modules/mcp-zebrunner/`
- Windows: `%APPDATA%\npm\node_modules\mcp-zebrunner\`

### Method 2: Local Installation

Install in a specific project directory:

```bash
# Navigate to your project directory
cd /path/to/your/project

# Install locally
npm install mcp-zebrunner
```

**Location after installation:**
- `./node_modules/mcp-zebrunner/`

### Verify Installation

Check that the package was installed correctly:

```bash
# For global installation
npm list -g mcp-zebrunner

# For local installation
npm list mcp-zebrunner
```

### Check Registry Status

Verify the package is available in the MCP Registry:

```bash
curl "https://registry.modelcontextprotocol.io/v0/servers?search=zebrunner"
```

---

## Required Configuration

The Zebrunner MCP Server requires **3 mandatory environment variables**:

| Variable | Description | Example |
|----------|-------------|---------|
| `ZEBRUNNER_URL` | Base URL of your Zebrunner instance | `https://your-company.zebrunner.com` |
| `ZEBRUNNER_LOGIN` | Your Zebrunner username/login | `john.doe@company.com` |
| `ZEBRUNNER_TOKEN` | Your Zebrunner API authentication token | `zt_abc123...` |

### How to Get Your Zebrunner Token

1. Log into your Zebrunner instance
2. Navigate to **User Profile** → **API Tokens**
3. Generate a new token or copy an existing one
4. Save it securely - you'll need it for configuration

---

## Optional Configuration

The following environment variables are **optional** and have default values:

### API & Performance Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `TIMEOUT` | API request timeout in milliseconds | `30000` (30 seconds) |
| `RETRY_ATTEMPTS` | Number of retry attempts for failed requests | `3` |
| `RETRY_DELAY` | Delay between retry attempts (ms) | `1000` (1 second) |
| `MAX_PAGE_SIZE` | Maximum page size for paginated requests | `100` (max: 1000) |
| `DEFAULT_PAGE_SIZE` | Default page size for paginated requests | `10` |

### Feature Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG` | Enable debug logging | `false` |
| `ENABLE_RULES_ENGINE` | Enable rules engine for test case validation | `auto` (auto-detected from `mcp-zebrunner-rules.md` file) |

### Security Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `STRICT_URL_VALIDATION` | Enable strict URL validation for security | `true` |
| `SKIP_URL_VALIDATION_ON_ERROR` | Skip validation if it fails (less secure) | `false` |

### Rate Limiting

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_RATE_LIMITING` | Enable rate limiting for API calls | `true` |
| `MAX_REQUESTS_PER_SECOND` | Maximum API requests per second | `5` (max: 100) |
| `RATE_LIMITING_BURST` | Allow burst of API requests | `10` (max: 200) |

---

## Client Configuration

### Claude Desktop

Claude Desktop uses a configuration file to manage MCP servers.

#### Configuration File Location

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

#### Configuration Steps

1. **Locate or create the configuration file**

   ```bash
   # macOS - Open with your editor
   open ~/Library/Application\ Support/Claude/claude_desktop_config.json
   
   # Windows - Open with Notepad
   notepad %APPDATA%\Claude\claude_desktop_config.json
   ```

2. **Add the Zebrunner MCP Server configuration**

   For **global installation**:
   ```json
   {
     "mcpServers": {
       "zebrunner": {
         "command": "node",
         "args": ["/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js"],
         "env": {
           "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
           "ZEBRUNNER_LOGIN": "your-username",
           "ZEBRUNNER_TOKEN": "your-api-token"
         }
       }
     }
   }
   ```

   For **local installation**:
   ```json
   {
     "mcpServers": {
       "zebrunner": {
         "command": "node",
         "args": ["/path/to/your/project/node_modules/mcp-zebrunner/dist/server.js"],
         "env": {
           "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
           "ZEBRUNNER_LOGIN": "your-username",
           "ZEBRUNNER_TOKEN": "your-api-token"
         }
       }
     }
   }
   ```

3. **Add optional environment variables** (if needed):

   ```json
   {
     "mcpServers": {
       "zebrunner": {
         "command": "node",
         "args": ["/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js"],
         "env": {
           "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
           "ZEBRUNNER_LOGIN": "your-username",
           "ZEBRUNNER_TOKEN": "your-api-token",
           "DEBUG": "true",
           "TIMEOUT": "60000",
           "MAX_PAGE_SIZE": "50"
         }
       }
     }
   }
   ```

4. **Restart Claude Desktop** for changes to take effect.

---

### Cursor

Cursor supports MCP servers through its configuration.

#### Configuration Steps

1. **Open Cursor Settings**
   - Press `Cmd/Ctrl + ,` to open settings
   - Navigate to **MCP Servers** or search for "MCP"

2. **Add MCP Server Configuration**

   **Method A: Using Cursor's MCP UI (if available)**
   - Click "Add MCP Server"
   - Enter the following details:
     - **Name:** `zebrunner`
     - **Command:** `node`
     - **Args:** `/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js` (or local path)
     - **Environment Variables:** Add ZEBRUNNER_URL, ZEBRUNNER_LOGIN, ZEBRUNNER_TOKEN

   **Method B: Edit settings.json manually**
   
   Open Cursor's `settings.json`:
   ```json
   {
     "mcp.servers": {
       "zebrunner": {
         "command": "node",
         "args": ["/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js"],
         "env": {
           "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
           "ZEBRUNNER_LOGIN": "your-username",
           "ZEBRUNNER_TOKEN": "your-api-token"
         }
       }
     }
   }
   ```

3. **Reload Cursor** or restart the window for changes to take effect.

---

### IntelliJ IDEA

IntelliJ IDEA can integrate with MCP servers through plugins or external tools.

#### Configuration Steps

1. **Install MCP Plugin** (if available)
   - Go to **Settings** → **Plugins**
   - Search for "Model Context Protocol" or "MCP"
   - Install the plugin and restart IntelliJ IDEA

2. **Configure External Tool** (alternative approach)

   If no plugin is available, set up MCP as an external tool:

   **Step 1: Create External Tool**
   - Go to **Settings** → **Tools** → **External Tools**
   - Click the **+** button to add a new tool
   - Configure:
     - **Name:** `Zebrunner MCP Server`
     - **Program:** `node`
     - **Arguments:** `/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js`
     - **Working directory:** `$ProjectFileDir$`

   **Step 2: Set Environment Variables**
   - In the External Tool configuration, click **Environment Variables**
   - Add:
     - `ZEBRUNNER_URL=https://your-instance.zebrunner.com`
     - `ZEBRUNNER_LOGIN=your-username`
     - `ZEBRUNNER_TOKEN=your-api-token`

3. **Run the MCP Server**
   - Go to **Tools** → **External Tools** → **Zebrunner MCP Server**
   - The server will start and listen for requests

#### Using .env File (Recommended for IntelliJ)

Create a `.env` file in your project root:

```bash
ZEBRUNNER_URL=https://your-instance.zebrunner.com
ZEBRUNNER_LOGIN=your-username
ZEBRUNNER_TOKEN=your-api-token
DEBUG=false
```

Then run the server with:
```bash
node /usr/local/lib/node_modules/mcp-zebrunner/dist/server.js
```

---

### ChatGPT Desktop

ChatGPT Desktop may support MCP servers through custom integrations.

#### Configuration Steps

1. **Open ChatGPT Desktop Settings**
   - Navigate to **Settings** → **Integrations** or **Advanced**

2. **Add Custom MCP Server** (if supported)

   ```json
   {
     "mcp_servers": {
       "zebrunner": {
         "command": "node",
         "args": ["/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js"],
         "environment": {
           "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
           "ZEBRUNNER_LOGIN": "your-username",
           "ZEBRUNNER_TOKEN": "your-api-token"
         }
       }
     }
   }
   ```

3. **Alternative: Run as Standalone Server**

   If direct integration isn't available, run the MCP server separately:

   ```bash
   # Set environment variables
   export ZEBRUNNER_URL="https://your-instance.zebrunner.com"
   export ZEBRUNNER_LOGIN="your-username"
   export ZEBRUNNER_TOKEN="your-api-token"

   # Run the server
   node /usr/local/lib/node_modules/mcp-zebrunner/dist/server.js
   ```

   Then configure ChatGPT Desktop to connect to the running server.

**Note:** MCP support in ChatGPT Desktop may vary. Check the official ChatGPT documentation for the latest integration methods.

---

## Verification & Testing

### 1. Verify Installation

Check that the package is installed correctly:

```bash
# Global installation
which node
npm list -g mcp-zebrunner

# Local installation
npm list mcp-zebrunner
ls -la node_modules/mcp-zebrunner/dist/
```

### 2. Test Server Manually

Run the server manually to check for errors:

```bash
# Set environment variables
export ZEBRUNNER_URL="https://your-instance.zebrunner.com"
export ZEBRUNNER_LOGIN="your-username"
export ZEBRUNNER_TOKEN="your-api-token"

# Run the server
node /usr/local/lib/node_modules/mcp-zebrunner/dist/server.js
```

**Expected Output:**
- The server should start without errors
- You should see logs indicating MCP server initialization
- If `DEBUG=true`, you'll see detailed configuration output

### 3. Test in Client

**For Claude Desktop:**
1. Restart Claude Desktop
2. Open a new conversation
3. Type a prompt related to Zebrunner (e.g., "Show me test cases from Zebrunner")
4. Check if Claude can access Zebrunner data

**For Cursor:**
1. Reload Cursor window
2. Open the MCP panel or command palette
3. Look for "Zebrunner" in the list of available servers
4. Try executing a Zebrunner-related command

**For IntelliJ IDEA:**
1. Run the external tool or plugin
2. Check the console for startup logs
3. Verify no errors appear

**For ChatGPT Desktop:**
1. Restart ChatGPT Desktop
2. Check the integrations panel
3. Verify the Zebrunner MCP server appears in the list

### 4. Test API Connection

Create a test script to verify API connectivity:

```javascript
// test-zebrunner-connection.js
import { ZebrunnerClient } from 'mcp-zebrunner';

const client = new ZebrunnerClient({
  baseUrl: process.env.ZEBRUNNER_URL,
  login: process.env.ZEBRUNNER_LOGIN,
  authToken: process.env.ZEBRUNNER_TOKEN
});

// Test connection
async function testConnection() {
  try {
    const projects = await client.getProjects();
    console.log('✅ Connection successful!');
    console.log(`Found ${projects.length} projects`);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
  }
}

testConnection();
```

Run the test:
```bash
node test-zebrunner-connection.js
```

---

## Troubleshooting

### Common Issues

#### Issue 1: "Module not found" Error

**Problem:** Client can't find the mcp-zebrunner module.

**Solution:**
- Verify installation: `npm list -g mcp-zebrunner`
- Check the path in your configuration file
- For global installation, find the correct path:
  ```bash
  npm root -g
  # Then use: <npm-root>/mcp-zebrunner/dist/server.js
  ```

#### Issue 2: "Missing required environment variables" Error

**Problem:** Required environment variables are not set.

**Solution:**
- Ensure all 3 required variables are set:
  - `ZEBRUNNER_URL`
  - `ZEBRUNNER_LOGIN`
  - `ZEBRUNNER_TOKEN`
- Check for typos in variable names
- Verify the values are correct (no extra spaces, quotes, etc.)

#### Issue 3: Authentication Failed

**Problem:** "401 Unauthorized" or similar authentication errors.

**Solution:**
- Verify your Zebrunner token is valid and not expired
- Regenerate the token in Zebrunner if needed
- Check that `ZEBRUNNER_URL` doesn't have trailing slashes
- Ensure `ZEBRUNNER_LOGIN` matches your Zebrunner username exactly

#### Issue 4: Timeout Errors

**Problem:** Requests to Zebrunner API are timing out.

**Solution:**
- Increase the `TIMEOUT` value: `"TIMEOUT": "60000"` (60 seconds)
- Check your network connection to Zebrunner
- Verify the Zebrunner instance is accessible from your network
- Consider adjusting `RETRY_ATTEMPTS` and `RETRY_DELAY`

#### Issue 5: Server Not Appearing in Client

**Problem:** The MCP server doesn't show up in the client.

**Solution:**
- Restart the client application completely
- Check client logs for error messages
- Verify the configuration file syntax (valid JSON)
- Ensure the configuration file is in the correct location
- Try running the server manually to check for errors

#### Issue 6: Rate Limiting Errors

**Problem:** Getting rate limit errors from Zebrunner API.

**Solution:**
- Enable rate limiting: `"ENABLE_RATE_LIMITING": "true"`
- Adjust rate limiting settings:
  - `"MAX_REQUESTS_PER_SECOND": "3"` (lower value)
  - `"RATE_LIMITING_BURST": "5"` (lower value)
- Contact your Zebrunner administrator about API limits

### Debug Mode

Enable debug mode for detailed logging:

```json
{
  "env": {
    "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
    "ZEBRUNNER_LOGIN": "your-username",
    "ZEBRUNNER_TOKEN": "your-api-token",
    "DEBUG": "true"
  }
}
```

Debug mode will show:
- Configuration loading details
- API request/response information
- Rules engine detection status
- Environment variable values (tokens are masked)

### Getting Help

If you continue to experience issues:

1. **Check the logs** - Look for error messages in:
   - Client application logs
   - Terminal output (if running manually)
   - System console logs

2. **Review the documentation**:
   - Main README: https://github.com/maksimsarychau/mcp-zebrunner
   - Changelog: https://github.com/maksimsarychau/mcp-zebrunner/blob/main/change-logs.md

3. **Report issues**:
   - GitHub Issues: https://github.com/maksimsarychau/mcp-zebrunner/issues
   - Include:
     - Client name and version
     - Operating system
     - Node.js version
     - Error messages (with sensitive data removed)
     - Configuration (with credentials removed)

---

## Additional Resources

- **npm Package**: https://www.npmjs.com/package/mcp-zebrunner
- **GitHub Repository**: https://github.com/maksimsarychau/mcp-zebrunner
- **MCP Registry**: Search for "zebrunner" at https://registry.modelcontextprotocol.io
- **License**: GNU AGPL v3.0

---

## Quick Reference

### Minimal Configuration (Required Only)

```json
{
  "mcpServers": {
    "zebrunner": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js"],
      "env": {
        "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
        "ZEBRUNNER_LOGIN": "your-username",
        "ZEBRUNNER_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Full Configuration (With Optional Settings)

```json
{
  "mcpServers": {
    "zebrunner": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/mcp-zebrunner/dist/server.js"],
      "env": {
        "ZEBRUNNER_URL": "https://your-instance.zebrunner.com",
        "ZEBRUNNER_LOGIN": "your-username",
        "ZEBRUNNER_TOKEN": "your-api-token",
        "DEBUG": "true",
        "TIMEOUT": "60000",
        "RETRY_ATTEMPTS": "5",
        "RETRY_DELAY": "2000",
        "MAX_PAGE_SIZE": "50",
        "DEFAULT_PAGE_SIZE": "20",
        "ENABLE_RULES_ENGINE": "true",
        "STRICT_URL_VALIDATION": "true",
        "ENABLE_RATE_LIMITING": "true",
        "MAX_REQUESTS_PER_SECOND": "5",
        "RATE_LIMITING_BURST": "10"
      }
    }
  }
}
```

---

**Version:** 5.12.0  
**Last Updated:** December 2, 2025  
**Maintainer:** Maksim Sarychau
