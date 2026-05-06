# MCP Zebrunner: Executive Summary

**Author:** Maksim Sarychau

---

## Overview

MCP Zebrunner is a bridge between Zebrunner and AI assistants (Claude, Cursor, ChatGPT, IntelliJ IDEA) that enables natural‑language access to test data, analysis, and reporting. It reduces manual navigation, standardizes output, and accelerates decision‑making across QA, engineering, and leadership.

---

## The Problem Addressed

Test organizations spend significant time on repetitive, manual tasks:

- **Switching between tools** — navigating dashboards, copying data, reformatting reports  
- **Searching for test cases** — finding specific tests across large projects  
- **Analyzing failures** — reviewing logs, screenshots, and videos manually  
- **Generating reports** — compiling metrics for stakeholders  
- **Identifying duplicates** — finding redundant test cases that slow execution

These tasks slow test cycles, reduce signal quality, and add reporting overhead.

---

## The Solution

MCP Zebrunner provides a natural‑language interface for test management. Instead of navigating UIs, teams can ask:

| Instead of... | Ask... |
|---------------|--------|
| Navigating to test case details | *"Get test case MCP-123 details"* |
| Manually reviewing failures | *"Why did test 5451420 fail?"* |
| Building custom reports | *"Generate weekly regression stability report"* |
| Searching across suites | *"Find all login-related tests"* |
| Analyzing launch results | *"Analyze launch 120906 failures"* |
| Manually creating test cases | *"Create a test case with 5 steps in project MCP"* |

---

## Key Capabilities

### 🔍 Test Failure Analysis
- Deep forensic analysis of failed tests  
- Automated screenshot and video analysis  
- Error classification and root‑cause suggestions  
- Comparison with last passed execution

### 📋 Test Case Management
- Retrieve, search, and filter test cases  
- **Create and update** test cases and suites via natural language (Beta)  
- Validate quality against best practices  
- AI‑powered improvement suggestions  
- Duplicate detection (exact and semantic)

### 🔒 Mutation Safety (v7.0.0+)
- **Two-step confirmation gate** — preview before every write operation  
- **Forced draft** — all created test cases start as drafts for review  
- **Audit logging** — every mutation recorded to `~/.mcp-zebrunner-audit.jsonl`  
- **Source traceability** — copied test cases include a link to the original  
- **Runtime validation** — priorities, automation states, and custom fields validated before execution

### 🚀 Launch & Execution Management
- Launch details and summaries  
- Platform‑specific results (iOS, Android, Web)  
- Milestone/build tracking  
- Test run history and trends

### 📊 Reporting & Analytics
- Bug analysis and top defects  
- Quality metrics and coverage analysis  
- Jira‑ready ticket generation  
- Management‑ready markdown reports

### 🧪 Automation Support
- Test code generation (Java, Python, JavaScript)  
- Automation readiness assessment  
- Coverage analysis between test cases and implementations  
- Framework detection and template matching

### 🎯 Feature‑Based Aggregation
- Find all test cases related to a feature keyword  
- Group results by suite hierarchy  
- Generate automation tags for targeted runs

---

## Who Benefits

| Role | Key Benefits |
|------|--------------|
| **Manual QA Engineers** | Faster test case reviews, quality validation, improvement suggestions |
| **Automation Engineers (SDETs)** | Code generation, automation readiness assessment, coverage analysis |
| **Developers** | Faster failure investigation and clearer test requirements |
| **QA Managers** | Instant quality dashboards, duplicate detection, consistent metrics |
| **Executives/Leadership** | Release risk visibility, standardized reporting, clear trends |

---

## Current State

### Distribution
- ✅ **npm Registry** — `npm install -g mcp-zebrunner`  
- ✅ **Docker Hub** — `msarychau/mcp-zebrunner:latest`
- ✅ **GitHub** — open source at github.com/maksimsarychau/mcp-zebrunner  
- ⚠️ **MCP Registry** — publication in progress

### Scale
- **60 tools** across test management, mutation, and reporting  
- **Multiple integrations** — Claude Desktop, Cursor, ChatGPT Desktop, IntelliJ IDEA, Docker  
- **Rules engine** for quality validation  
- **Multiple output formats** — JSON, Markdown, Jira‑ready

### Compatibility
- Works with any Zebrunner instance  
- Supports MCP‑compatible AI assistants  
- Cross‑platform (macOS, Windows, Linux)

---

## Business Impact

### Time Savings
| Task | Before | After |
|------|--------|-------|
| Test failure investigation | 15–30 min | 2–5 min |
| Finding related test cases | 10–20 min | 30 sec |
| Generating Jira tickets | 5–10 min | 1 min |
| Weekly quality reports | 1–2 hours | 10 min |
| Duplicate analysis | Manual/impossible | Automated |

### Quality Improvements
- **Consistent validation** across teams  
- **Proactive duplicate detection** reduces redundant execution  
- **AI‑assisted suggestions** drive continuous improvement  
- **Standardized reporting** for stakeholders

### Accessibility
- **No specialized query language** required  
- **Natural‑language interface** for any role  
- **Immediate answers** without manual compilation

---

## Evolution Timeline

| Version | Milestone |
|---------|-----------|
| v1.x | Basic test case retrieval |
| v2.x | Suite hierarchy and batch operations |
| v3.x | Test failure analysis and screenshots |
| v4.x | Video analysis, Jira integration, intelligent rules |
| v5.x | Docker support, MCP Registry, feature aggregation |
| v6.x | Stealth integrity protection, cryptographic signing, remote control |
| v7.x | Mutation tools (create/update test cases & suites), two-step confirmation, audit logging, universal report generator |

---

## Technical Foundation

Built on the **Model Context Protocol (MCP)** — an open standard for connecting AI assistants to external tools and data sources. This ensures:

- **Future‑proof compatibility** with MCP assistants  
- **Secure architecture** with credentials kept local  
- **Extensibility** for new tools and workflows  
- **Standards alignment** for enterprise adoption

---

## What’s Next

Planned enhancements:
- Enhanced semantic search across test cases  
- Predictive failure analysis  
- Test case generation from requirements  
- CI/CD integration  
- Enterprise SSO support (Okta, SAML)

---

## Quick Links

- **Installation Guide:** [INSTALL-GUIDE.md](../INSTALL-GUIDE.md)
- **npm Guide:** [MCP_NPM_INSTALLATION_GUIDE.md](../MCP_NPM_INSTALLATION_GUIDE.md)
- **Docker Guide:** [DOCKER_USAGE.md](DOCKER_USAGE.md)
- **Full Tools Catalog:** [TOOLS_CATALOG.md](../TOOLS_CATALOG.md)
- **Change Log:** [change-logs.md](../change-logs.md)

---

**Bottom line:** MCP Zebrunner makes test intelligence accessible across roles, reduces reporting overhead, and improves release decision speed and quality.

---

*Last Updated: April 2026*
