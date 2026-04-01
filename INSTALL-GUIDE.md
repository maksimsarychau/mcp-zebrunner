# 🟢 MCP-Zebrunner — Step-by-Step Install & Update Guide

> 📚 **Looking for more features and documentation?** Return to the main [**README**](README.md) for complete tool overview and usage examples.

This guide explains in **very simple steps** how to install and update the **MCP-Zebrunner** server and connect it to **Claude Desktop** or **Claude Code**.

---

## 1. Install Required Software

1. Install **Git** and **Node.js** (version 18 or newer):
   - Windows: Download from https://nodejs.org
   - macOS: Run in terminal:
     ```bash
     brew install git node
     ```

2. Check installation:
   ```bash
   node --version
   npm --version
   git --version
   ```

If you see version numbers, everything is fine.

---

## 2. Get the Code

Recommendation to create a separate folder like src 
```bash
mkdir src
cd src
```

1. Open **Terminal** (macOS/Linux) or **Command Prompt** (Windows).
2. Run:
   ```bash
   git clone https://github.com/maksimsarychau/mcp-zebrunner.git
   cd mcp-zebrunner
   ```

(Alternatively: click “Code → Download ZIP” on GitHub, unzip, and open the folder.)

---

## 3. Configure Zebrunner Connection

1. In the project folder, create a new file named **.env**  
   (Note: the file name is exactly `.env`, no extension).

   To do it based on .env.example you should call (For macOS):
```bash
cp .env.example .env
```

2. Add this content (replace with your own values):

To edit `.env` file from the terminal on macOS:
```bash
nano .env
```

   ```env
   ZEBRUNNER_URL=https://your-company.zebrunner.com/api/public/v1
   ZEBRUNNER_LOGIN=your.email@company.com
   ZEBRUNNER_TOKEN=your_api_token_here
   DEBUG=false
   ENABLE_RULES_ENGINE=true
   ```


3. To get your Zebrunner token:
   - Log in to Zebrunner
   - Go to your profile settings → API Access
   - Create a token and paste it into `.env`

4. After updating all parameters in `.env` you should save it in Nano editor using command: `Control+O (^O WriteOut)`
And to exit from Nano editor use command: `Control+X (^X Exit)`

---

## 4. Install Dependencies

Run this inside the project folder:

```bash
npm install
```

---

## 5. Build the Project

```bash
npm run build
```

---

## 6. Test the Setup

Run it if you have `.env` configured:

```bash
npm run test:health
```

If you see ✅ Health check completed → you’re ready.

---

## 7. Connect to Claude Desktop application 

🖥️ Install Claude Desktop
1.	Go to the official Anthropic download page:
👉 https://claude.ai/download
2.	Choose your system:
   - macOS → click Download for Mac
   - Windows → click Download for Windows
3.	Once downloaded:
  - On Mac, open the .dmg file and drag Claude.app into your Applications folder.
  - On Windows, run the .exe installer and follow the prompts.
4.	Open the Claude app and sign in with your Anthropic account (the same one you use on the web).

⚡ Tip: After install, you can link your MCP server (your Zebrunner MCP) in Claude’s Settings → MCP Servers by entering the path to your server executable.


Claude Desktop reads MCP servers from a JSON config file you can edit from Settings → Developer → Edit Config, which opens folder for `claude_desktop_config.json`. 
Paths:

   - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
   - Windows: %APPDATA%\Claude\claude_desktop_config.json

(These are the standard locations described in official MCP connection guides.)

1. Open Claude Desktop → **Settings → Developer → Edit Config**.
2. To edit `claude_desktop_config.json` file on macOS use Right click and open file with `TextEditor`
3. Add an entry under "mcpServers" pointing to your local server (replace with your actual folder path). 
Example: 

```json
{
  "mcpServers": {
    "mcp-zebrunner": {
      "command": "node",
      "args": ["/full/absolute/path/to/mcp-zebrunner/dist/server.js"],
      "env": {
        "ZEBRUNNER_URL": "https://your-company.zebrunner.com/api/public/v1",
        "ZEBRUNNER_LOGIN": "your.email@company.com",
        "ZEBRUNNER_TOKEN": "your_api_token_here",
        "DEBUG": "false",
        "ENABLE_RULES_ENGINE": "true",
        "DEFAULT_PAGE_SIZE": "100",
        "MAX_PAGE_SIZE": "100"
      }
    }
  }
}
```
4. To get your actual absolute path use command on macOS terminal in folder where we have `mcp-zebrunner` cloned: 
```bash
pwd
```

**Example paths:**
- **Windows:** `C:\\Users\\YourName\\Projects\\mcp-zebrunner\\dist\\server.js`
- **macOS/Linux:** `/Users/YourName/Projects/mcp-zebrunner/dist/server.js`

5. Replace `/full/absolute/path/to/mcp-zebrunner/` with absolute path what you get from `pwd`.
   - 👉 Don't forget to add `/dist/server.js`

6. Save `claude_desktop_config.json` file in **TextEditor**

7. Restart Claude Desktop.

8. Open a chat and type `/mcp` → you should see **mcp-zebrunner** connected.

---

## 8. Connect to Claude Code

1. You can also add the server using the command line:

```bash
claude mcp add --scope user mcp-zebrunner \
  --env ZEBRUNNER_URL="https://your-company.zebrunner.com/api/public/v1" \
  --env ZEBRUNNER_LOGIN="your.email@company.com" \
  --env ZEBRUNNER_TOKEN="your_api_token_here" \
  --env DEBUG="false" \
  --env ENABLE_RULES_ENGINE="true" \
  -- node /full/absolute/path/to/mcp-zebrunner/dist/server.js
```

**Example paths:**
- **Windows:** `C:\\Users\\YourName\\Projects\\mcp-zebrunner\\dist\\server.js`
- **macOS/Linux:** `/Users/YourName/Projects/mcp-zebrunner/dist/server.js`

2. To get your actual absolute path use command on macOS terminal in folder where we have `mcp-zebrunner` cloned: 
```bash
pwd
```

3. Replace `/full/absolute/path/to/mcp-zebrunner/` with absolute path what you get from `pwd`.
Don't forget to add `/dist/server.js`

4. Replace `ZEBRUNNER_URL`, `ZEBRUNNER_LOGIN` and `ZEBRUNNER_TOKEN` with your actual values.

5. Restart Claude Code.
6. Run `/mcp` inside Claude Code terminal → check that **mcp-zebrunner** appears.
7. Important - without setting `--scope user` during MCP installation only current folder will have access to the MCP. To make it installed globally use `--scope user`
8. Check that everything is ok: 
```bash 
claude mcp list
```

---

## 9. Updating MCP-Zebrunner

Whenever a new version is released:

### Check current version
```bash
# Check your current version
npm run version
```
### Update steps
```bash
cd mcp-zebrunner
git pull origin master
npm install
npm run build
## (Optional) Only if you have .env configured properly
npm run test:health
```

**Important Notes:**
- ✅ **Your `.env` file must be properly configured** for the health check to work
- ✅ **Restart Claude Desktop/Code** after updating to reload the MCP server
- ✅ **Check release notes** for any breaking changes before updating

---

## 10. Common Problems

- ❌ **Auth failed (401)** → Check `.env` values (login, token).  
- ❌ **Not found (404)** → Check your project key in Zebrunner.  
- ❌ **Claude cannot see server** → Make sure paths in config are correct and project is built.

---

✅ You are now ready to use MCP-Zebrunner with Claude!
> 📚 **Looking for more features and documentation?** Return to the main [**README**](README.md) for complete tool overview and usage examples
