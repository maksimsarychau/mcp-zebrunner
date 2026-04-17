# Manual Test Guide: Mode 4 (Okta OAuth)

This guide covers end-to-end testing of Mode 4 (Okta OAuth + per-user Zebrunner credentials).

## Prerequisites

- Okta OIDC Web Application configured (see `docs/HOSTING_GUIDE.md`)
- Okta Authorization Server ("default") with Access Policy + Rule
- Docker or local Node.js environment
- `.env` file with Mode 4 configuration

## Setup

### 1. Configure `.env`

```env
ZEBRUNNER_URL=https://your-instance.zebrunner.com/api/public/v1
PORT=3000
MCP_AUTH_MODE=okta
TOKEN_STORE_PATH=./data/tokens.enc
TOKEN_STORE_KEY=any-strong-secret-for-encryption
OKTA_DOMAIN=your-org.okta.com
OKTA_CLIENT_ID=0oa...
OKTA_CLIENT_SECRET=your-client-secret
OKTA_AUTH_SERVER_ID=default
```

Note: **No `ZEBRUNNER_LOGIN` or `ZEBRUNNER_TOKEN`** — each user provides their own.

### 2. Start the server

```bash
# Docker
docker compose -f docker-compose.yml -f docker-compose.http.yml up

# Or local
PORT=3000 npx tsx src/server.ts
```

### 3. Run pre-flight checks

```bash
./tests/manual/test-preflight.sh 3000
```

Expected output:
```
  PASS  GET /health returns 200 (HTTP 200)
  INFO  "authMode":"okta"
  INFO  "oauthEnabled":true
  PASS  GET /.well-known/oauth-authorization-server (HTTP 200)
  PASS  POST /mcp without auth → 401 (HTTP 401)
  PASS  GET /login?state=... returns 200 (credential form)
```

## Test Flow

### Test 1: First-time user connection

1. Add to `~/.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "zebrunner-test": {
         "url": "http://localhost:3000/mcp"
       }
     }
   }
   ```

2. Reload Cursor (Cmd+Shift+P -> "Developer: Reload Window")

3. In MCP settings, the server appears as "Needs authentication"

4. Click **Connect** -> browser opens

5. **Expected: Okta login page** (or instant SSO if already signed in)

6. Authenticate with Okta (+ Duo MFA if configured)

7. **Expected: Zebrunner credential form** appears after Okta login
   - Title: "Connect to Zebrunner"
   - Fields: Username/email + API token

8. Enter your Zebrunner username and API token

9. **Expected: Browser redirects back** and Cursor shows green dot

10. Ask the AI: "list Zebrunner projects" or "get test cases for project X"

11. **Expected: Real Zebrunner data returned**

### Test 2: Reconnection (credentials already stored)

1. Disconnect the MCP server in Cursor settings

2. Click **Connect** again

3. **Expected: Okta login** (or instant if SSO session active)

4. **Expected: No credential form** this time (stored from Test 1)

5. Cursor shows green dot immediately after Okta login

6. Tools work as before

### Test 3: Different Okta user

1. Use a different browser profile or incognito mode

2. Connect to the same server URL

3. **Expected: Okta login** with different credentials

4. **Expected: Zebrunner credential form** appears (new user, no stored creds)

5. Enter different Zebrunner credentials

6. Both users can use the server independently with their own credentials

### Test 4: Invalid Zebrunner credentials

1. Clear `data/tokens.enc` (or use new TOKEN_STORE_KEY)

2. Connect via Cursor -> Okta login -> credential form

3. Enter wrong API token

4. **Expected: Error message** "Invalid API token. Please check your credentials and try again."

5. Re-enter correct credentials

6. **Expected: Success**, green dot in Cursor

## Verification Checklist

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 1 | `/health` shows `authMode: "okta"` | `{"authMode":"okta","oauthEnabled":true}` | |
| 2 | `/mcp` without auth | 401 | |
| 3 | `/.well-known/oauth-authorization-server` | Valid JSON with endpoints | |
| 4 | Cursor Connect -> browser opens | Okta login page | |
| 5 | After Okta login (first time) | Credential form appears | |
| 6 | After credential entry | Cursor shows green dot | |
| 7 | Tool call works | Returns real Zebrunner data | |
| 8 | Reconnection | No credential form (stored) | |
| 9 | Different user | Gets their own credential form | |
| 10 | Invalid API token | Error message, can retry | |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Okta 400 "Policy evaluation failed" | No Access Policy on auth server | Add Policy + Rule in Security -> API -> default |
| "Client secret is required" in logs | Old server build | Rebuild (DCR now defaults to public client) |
| Credential form doesn't appear after Okta | Login route not mounted | Check `ZEBRUNNER_URL` is set in `.env` |
| "No Zebrunner credentials found" on tool call | TokenStore not configured | Ensure `TOKEN_STORE_PATH` + `TOKEN_STORE_KEY` in `.env` |
| "Token expired" on reconnection | Server-signed JWT expired | Re-authenticate (24h TTL for selfauth) |
