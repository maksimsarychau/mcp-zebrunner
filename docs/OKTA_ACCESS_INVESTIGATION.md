# Okta Access Investigation for Enterprise MCP Integration

## Overview

This document outlines the investigation and potential approaches for integrating Zebrunner MCP with enterprise SSO (Okta) for use with Claude Desktop and Docker MCP Toolkit.

## Current State

### Zebrunner Authentication

| Method | Supported | Use Case |
|--------|-----------|----------|
| **API Token** | ✅ Yes | Current MCP implementation |
| **SAML 2.0** | ✅ Yes | Web browser SSO via Okta |
| **OAuth 2.0** | ❓ Unknown | Needs investigation |

### Zebrunner SAML Configuration

Zebrunner supports SAML 2.0 with Service Provider (SP) initiated flow:

- **Documentation**: https://zebrunner.com/documentation/guide/sso/
- **IdP Support**: Okta, Azure AD, and other SAML 2.0 providers
- **SAML Attributes**:
  - `User.FirstName` (required)
  - `User.LastName` (required)
  - `User.PhotoUrl` (required)
  - `Zebrunner.Access` (optional) - true/false for access control
  - `Zebrunner.Groups` (optional) - comma-separated group list

### The Challenge

| What Zebrunner Has | What MCP Needs | Gap |
|--------------------|----------------|-----|
| SAML 2.0 (browser SSO) | OAuth 2.0 or API tokens | Different protocols |
| Web session authentication | Programmatic API auth | Different auth methods |
| User login flow | Service/machine auth | Need API credentials |

**Key Issue**: SAML 2.0 is browser-based and requires user interaction. MCP servers need programmatic API access without browser redirects.

---

## Proposed Solutions

### Option 1: Service Account (Current - Simplest)

**Status**: ✅ Currently implemented

```
Claude Desktop → MCP Server → Zebrunner API
                     ↓
              Service Account Token
              (shared for all users)
```

**Implementation**:
- Single Zebrunner service account
- One API token for all MCP requests
- Token stored as environment variable

**Pros**:
- Simple, works today
- No additional infrastructure

**Cons**:
- No per-user audit trail in Zebrunner
- All actions appear as service account

---

### Option 2: Per-User API Token Mapping

**Status**: 📋 Proposed

```
┌──────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Claude Desktop  │────▶│  Zebrunner MCP  │────▶│  Zebrunner API   │
│  (OAuth/SSO)     │     │  Server         │     │                  │
└──────────────────┘     └────────┬────────┘     └──────────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  Token Store    │
                         │  (User → Token) │
                         └─────────────────┘
```

**How It Works**:
1. User logs into Zebrunner via SAML/Okta (one-time)
2. User generates personal API token in Zebrunner settings
3. User registers token with MCP token store
4. MCP server looks up token based on authenticated user
5. API calls use user's personal token

**Components Needed**:

1. **Token Store** - Secure storage mapping users to Zebrunner tokens
   - Options: AWS Secrets Manager, HashiCorp Vault, encrypted database

2. **User Provisioning Flow** - One-time token registration
   - Web form, Slack bot, or CLI tool

3. **MCP Server Enhancement** - Token lookup based on user identity

**Code Changes Required**:

```typescript
// Conceptual change to server.ts
interface TokenStore {
  setToken(userId: string, zebrunnerToken: string): Promise<void>;
  getToken(userId: string): Promise<string | null>;
  deleteToken(userId: string): Promise<void>;
}

async function handleToolCall(request: MCPRequest) {
  const userId = request.context?.userId; // From OAuth/SSO
  const zebrunnerToken = await tokenStore.getToken(userId);
  
  const client = new ZebrunnerClient({
    baseUrl: ZEBRUNNER_URL,
    token: zebrunnerToken,
  });
  
  return await executeTool(client, request);
}
```

**Pros**:
- Per-user audit trail in Zebrunner
- Users see their own permissions
- Works with existing Zebrunner auth

**Cons**:
- Users must manually provision tokens
- Token management overhead
- Need to build token store

---

### Option 3: Custom Token Exchange Service

**Status**: 📋 Proposed (Complex)

```
┌──────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Claude Desktop  │────▶│  OAuth Proxy    │────▶│  Zebrunner MCP   │
│  (Okta OAuth)    │     │  Service        │     │  Server          │
└──────────────────┘     └────────┬────────┘     └──────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
           ┌─────────────────┐         ┌─────────────────┐
           │  Okta           │         │  Token Exchange │
           │  (Validate)     │         │  (Map to Zebr.) │
           └─────────────────┘         └─────────────────┘
```

**How It Works**:
1. Claude Desktop authenticates user via OAuth 2.0 (Okta)
2. Claude sends OAuth token to Token Exchange Service
3. Service validates token with Okta
4. Service maps user to Zebrunner credentials
5. Service calls Zebrunner MCP or returns credentials

**Components Needed**:

1. **Okta OAuth 2.0 App**
   - Create in Okta Admin Console
   - Configure for Claude Desktop (Native/Web app)
   - Note Client ID and Secret

2. **Token Exchange Service**
   - Express.js or similar web service
   - Validates Okta tokens
   - Maps users to Zebrunner credentials

3. **User-to-Zebrunner Mapping Database**

**Implementation Sketch**:

```typescript
// Token Exchange Service
import { OktaJwtVerifier } from '@okta/jwt-verifier';

const oktaVerifier = new OktaJwtVerifier({
  issuer: 'https://your-org.okta.com/oauth2/default',
  clientId: 'your-client-id',
});

app.post('/exchange', async (req, res) => {
  const { accessToken } = req.body;
  
  // 1. Validate Okta token
  const jwt = await oktaVerifier.verifyAccessToken(accessToken, 'api://default');
  const userEmail = jwt.claims.email;
  
  // 2. Look up Zebrunner credentials
  const zebrunnerCreds = await getZebrunnerCredentials(userEmail);
  
  // 3. Return credentials
  return res.json({
    zebrunnerUrl: zebrunnerCreds.url,
    zebrunnerToken: zebrunnerCreds.token,
  });
});
```

**Pros**:
- True SSO experience
- No manual token provisioning
- Centralized access control
- Can implement token refresh

**Cons**:
- More complex infrastructure
- Need to host exchange service
- Requires OAuth expertise
- More moving parts

---

## Comparison Matrix

| Aspect | Option 1 (Service Account) | Option 2 (Token Mapping) | Option 3 (Token Exchange) |
|--------|---------------------------|--------------------------|---------------------------|
| **Complexity** | Low | Medium | High |
| **User Experience** | Transparent | One-time token setup | Seamless SSO |
| **Per-User Audit** | ❌ No | ✅ Yes | ✅ Yes |
| **Infrastructure** | None | Token store | Exchange service + OAuth |
| **Maintenance** | Low | Medium | High |
| **Best For** | Development, small teams | Medium teams | Large enterprise |

---

## Recommendations

### Short Term (Now)
- Continue with **Option 1 (Service Account)**
- Works immediately with current implementation
- Suitable for development and small teams

### Medium Term (3-6 months)
- Implement **Option 2 (Token Mapping)**
- Add simple token store (encrypted JSON or Secrets Manager)
- Build token registration tool
- Enables per-user audit trails

### Long Term (6-12 months)
- Evaluate **Option 3 (Token Exchange)** if:
  - User base grows significantly
  - Enterprise requires seamless SSO
  - Security mandates centralized credential management

---

## Open Questions

1. **Does Zebrunner support OAuth 2.0 for API access?**
   - Contact Zebrunner support
   - Check REST API documentation

2. **Can API tokens be generated programmatically after SAML login?**
   - Would simplify Option 2

3. **What's the API token lifecycle?**
   - Expiration? Refresh capability?

4. **Enterprise Claude Desktop OAuth requirements?**
   - What OAuth flows does it support?
   - How is user identity passed to MCP servers?

---

## References

- [Zebrunner SSO Documentation](https://zebrunner.com/documentation/guide/sso/)
- [Docker MCP Registry](https://github.com/docker/mcp-registry)
- [MCP OAuth Specification](https://modelcontextprotocol.io/docs/concepts/authentication)
- [Okta OAuth 2.0 Guide](https://developer.okta.com/docs/guides/)

---

*Last Updated: December 2025*
