# MCP Resources & Prompts Guide

> **Version:** 7.2.1 | **Since:** v7.2.1

This guide covers two MCP features that complement the existing 60 tools:

- **Resources** (`@` menu) — read-only reference data injected into the conversation context
- **Prompts** (`/` commands) — pre-built, tested workflow instructions that guide the AI through multi-tool orchestrations

Both features are purely additive — they don't change any existing tool behavior.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Resources](#resources)
   - [What Are MCP Resources?](#what-are-mcp-resources)
   - [How to Use Resources](#how-to-use-resources)
   - [Static Resources](#static-resources)
   - [Template Resources (per-project)](#template-resources-per-project)
   - [Combining Resources](#combining-resources)
3. [Prompts](#prompts)
   - [What Are MCP Prompts?](#what-are-mcp-prompts)
   - [How to Use Prompts](#how-to-use-prompts)
   - [E2E Metric Prompts](#e2e-metric-prompts)
   - [Analysis Prompts](#analysis-prompts)
   - [Role-Specific Prompts](#role-specific-prompts)
4. [Combining Resources + Prompts](#combining-resources--prompts)
5. [Client Compatibility](#client-compatibility)
6. [Resource Reference Table](#resource-reference-table)
7. [Prompt Reference Table](#prompt-reference-table)
8. [Architecture (for contributors)](#architecture-for-contributors)
   - [File Structure](#file-structure)
   - [Caching Strategy](#caching-strategy)
   - [Adding New Resources](#adding-new-resources)
   - [Adding New Prompts](#adding-new-prompts)
   - [Testing](#testing)

---

## Quick Start

**Resources** — open the `@` menu in your MCP client and select a resource:

```
@ zebrunner://reports/types
```

The data is injected into your conversation. Then ask a question:

```
What report types are available?
```

**Prompts** — open the `/` menu and select a workflow:

```
/executive-dashboard
  projects: android,ios,web
```

The AI receives expert instructions and executes the multi-tool workflow automatically.

---

## Resources

### What Are MCP Resources?

Resources expose read-only reference data that MCP clients can fetch and inject into the conversation context. Unlike tools (which the AI calls on its own), resources are **user-initiated** — you select them explicitly via the `@` menu.

This is useful for:

- **Discoverability** — see what report types, periods, or projects are available without asking
- **Accuracy** — the AI gets exact parameter values instead of guessing
- **Efficiency** — one resource fetch replaces multiple discovery tool calls

### How to Use Resources

The exact interaction depends on your MCP client:

**Claude Desktop / Claude Code:**

1. Type `@` in the message input to open the resource picker
2. Browse or search for a resource (e.g., "report types")
3. Select the resource — its content is attached to your message
4. Ask your question naturally

**Cursor:**

Resources may appear in the `@` context menu. Support varies by Cursor version — check [Client Compatibility](#client-compatibility) for details.

**MCP Inspector (debugging):**

1. Click the "Resources" tab
2. Click "List Resources" to see all available resources
3. Click a resource to read its content
4. For template resources, fill in the `project_key` parameter

### Static Resources

These resources are always available and require no parameters. They return hardcoded reference data that doesn't depend on your Zebrunner instance.

#### `zebrunner://reports/types` — Report Types

Lists the 6 report types available in the `generate_report` tool with descriptions, parameters, default values, and usage examples.

**When to use:** Before generating a report, to see which types exist and what parameters they accept.

**Example conversation:**

```
User: @ zebrunner://reports/types
      What types of reports can I generate?

AI:   There are 6 report types available:
      1. quality_dashboard — comprehensive HTML + Markdown dashboard with 6 panels
      2. coverage — per-suite automation coverage table
      3. pass_rate — per-platform pass rate with target comparison
      4. runtime_efficiency — runtime metrics with delta comparison
      5. executive_dashboard — standup-ready combined report
      6. release_readiness — Go/No-Go recommendation
      
      You can combine multiple types in one call, e.g.:
      generate_report({ report_types: ["coverage", "pass_rate"], projects: ["android", "ios"] })
```

#### `zebrunner://periods` — Time Periods

Lists all 12 valid time period values with their day equivalents and which tools accept them.

**When to use:** To ensure you're using the exact period string the API expects (values are case-sensitive).

**Key values:** `Today`, `Last 24 Hours`, `Week`, `Last 7 Days`, `Last 14 Days`, `Month`, `Last 30 Days`, `Quarter`, `Last 90 Days`, `Year`, `Last 365 Days`, `Total`

#### `zebrunner://charts` — Chart Options

Lists chart delivery formats (`none`, `png`, `html`, `text`), chart types (`auto`, `pie`, `bar`, `stacked_bar`, `horizontal_bar`, `line`), and the 17 tools that support charts.

**When to use:** When you want a visual chart and need to know which format or type to request.

#### `zebrunner://formats` — Output Format Reference

Documents 5 format parameter families used across tools, with valid values per family.

| Family | Values | Used By |
|--------|--------|---------|
| data | `dto`, `json`, `string`, `markdown` | 18 TCM tools |
| data_simple | `dto`, `json`, `string` | 6 tools |
| raw_formatted | `raw`, `formatted` | 11 reporting tools |
| verbosity | `detailed`, `summary`, `jira` | 3 failure tools |
| metadata | `json`, `markdown` | 2 tools |

### Template Resources (per-project)

Template resources fetch live data from your Zebrunner instance. They require a `project_key` parameter and support autocomplete — the `@` menu lists one entry per project (e.g., "Android — Root Suites", "iOS — Milestones").

All template resource data is cached for **20 minutes** after the first fetch.

#### `zebrunner://projects` — Available Projects

Lists all Zebrunner projects accessible to the current user with keys, IDs, starred status, and public accessibility.

**When to use:** To discover which projects exist before using other tools.

#### `zebrunner://projects/{project_key}/suites` — Root Suites

Top-level test suites (suites with no parent) for a project.

**When to use:** To see the high-level suite structure before drilling into specific suites.

#### `zebrunner://projects/{project_key}/suite-hierarchy` — Full Suite Hierarchy

All test suites with parent-child relationships (`parentId`). The AI can reconstruct the full tree from this flat data.

**When to use:** To understand the complete suite organization of a project.

#### `zebrunner://projects/{project_key}/automation-states` — Automation States

Available automation states (e.g., Automated, Manual, Not Automated, To Be Automated) with IDs.

**When to use:** Before filtering test cases by automation state — provides exact state names and IDs.

#### `zebrunner://projects/{project_key}/priorities` — Priorities

Available priority levels (e.g., Critical, High, Medium, Low) with IDs.

**When to use:** Before filtering or updating test cases by priority.

#### `zebrunner://projects/{project_key}/milestones` — Milestones

Active and completed milestones (version tags) with IDs and completion status.

**When to use:** To find the correct milestone name for report generation or launch filtering.

#### `zebrunner://projects/{project_key}/result-statuses` — Result Statuses

Configured test run result statuses (e.g., Passed, Failed, Skipped, In Progress, Blocked).

**When to use:** Before creating or updating test runs to know valid status values.

#### `zebrunner://projects/{project_key}/configuration-groups` — Configuration Groups

Test run configuration groups and their options (e.g., Browser: Chrome/Firefox, OS: Windows/macOS).

**When to use:** When setting up test runs with specific configurations.

#### `zebrunner://projects/{project_key}/fields` — Fields Layout

System and custom field definitions with types, tab placement, and enabled status.

**When to use:** To understand which custom fields (e.g., `manualOnly`, `testrailId`) are available for filtering.

### Combining Resources

Attach multiple resources to a single message for richer context:

```
User: @ zebrunner://projects
      @ zebrunner://reports/types
      Generate an executive dashboard for all starred projects.

AI:   [Uses project keys from the projects resource and report_types: ["executive_dashboard"]
       from the report types resource — no guessing or discovery calls needed]
```

---

## Prompts

### What Are MCP Prompts?

Prompts are pre-built workflow instructions that you trigger via the `/` command menu. When you select a prompt and fill in its parameters, the MCP server returns expert-crafted text that tells the AI exactly which tools to call, in what order, and how to present the results.

Think of them as **saved workflows** — each prompt encapsulates a complex, multi-step process that has been tested and validated.

### How to Use Prompts

**Claude Desktop / Claude Code:**

1. Type `/` in the message input to open the prompt picker
2. Browse or search for a prompt (e.g., "executive dashboard")
3. Select the prompt — you'll be asked to fill in parameters (e.g., `projects: android,ios,web`)
4. The AI receives the workflow instructions and executes them automatically

**Cursor:**

Prompt support varies by Cursor version. If not available in the UI, you can copy prompt instructions from [docs/TEST_PROMPTS.md](TEST_PROMPTS.md) sections 14-15.

**MCP Inspector (debugging):**

1. Click the "Prompts" tab
2. Click "List Prompts" to see all available prompts
3. Click a prompt, fill in arguments, and click "Get Prompt"
4. Inspect the returned message content

### E2E Metric Prompts

These prompts orchestrate multiple tools to collect business-critical QA metrics. Each prompt specifies which tools to call, what data to collect, and how to present the results.

#### `/pass-rate`

**Parameters:** `projects` (comma-separated, e.g., `android,ios,web`)

Collects pass rate metrics across platforms with target comparison. The AI will:
1. Find launches by latest milestone per platform
2. Collect pass/fail/known-issue counts per launch
3. Calculate pass rates with and without known issues
4. Compare against targets (Android/iOS >= 90%, Web >= 65%)
5. Present a comparison table with status indicators

#### `/runtime-efficiency`

**Parameters:** `projects` (comma-separated)

Collects regression runtime efficiency metrics with delta comparison. Includes average runtime per test, WRI, duration distribution, and degradation alerts.

#### `/automation-coverage`

**Parameters:** `projects` (comma-separated)

Collects 7 automation coverage metrics per platform including automation intake rate (are new test cases being automated at the same rate they're being created?).

#### `/executive-dashboard`

**Parameters:** `projects` (comma-separated)

Generates a standup-ready executive dashboard with 5 sections: pass rate, regression runtime, top 5 bugs, test case coverage, and flaky tests.

#### `/release-readiness`

**Parameters:** `project` (single project key), `milestone` (optional, defaults to latest)

Runs a 5-check Go/No-Go assessment: pass rate, unresolved failures, runtime degradation, coverage, and defect density. Provides a clear recommendation with evidence.

#### `/suite-coverage`

**Parameters:** `projects` (comma-separated)

Builds per-suite automation coverage tables with TOTAL and TOTAL REGRESSION summary rows. Handles the "Manual Only" detection complexity (automation state vs custom field) automatically.

### Analysis Prompts

These prompts guide the AI through focused analysis workflows using 2-4 tools.

#### `/review-test-case`

**Parameters:** `case_key` (e.g., `MCP-5`)

Three-step quality review: fetch test case details, validate against quality standards, generate improvement suggestions. Returns a structured report with quality score and actionable fixes.

#### `/launch-triage`

**Parameters:** `project` (single project key)

Post-regression failure triage: finds the latest launch, identifies failures without linked Jira issues, performs root cause analysis on the top 3-5 failures, and recommends actions.

#### `/flaky-review`

**Parameters:** `project` (single project key)

Finds flaky tests over the last 30 days with execution history, analyzes the worst offenders, and produces a prioritized stabilization plan.

#### `/find-duplicates`

**Parameters:** `project` (single project key), `suite_id` (optional)

Runs structural (and optionally semantic) duplicate analysis, presenting duplicate groups with similarity scores and merge recommendations.

### Role-Specific Prompts

These prompts are tailored to common day-to-day workflows for specific roles.

#### `/daily-qa-standup`

**Parameters:** `projects` (comma-separated)

Prepares a concise daily standup summary: latest launch results per platform, unresolved failures, flaky tests in the last 7 days, and runtime trend. Presents as a table with action items.

**Best for:** QA leads preparing for daily standups.

#### `/automation-gaps`

**Parameters:** `projects` (comma-separated)

Identifies automation gaps: overall coverage, suites with lowest automation rates, recently created manual test cases, and a prioritized automation backlog.

**Best for:** SDETs and automation leads planning sprint work.

#### `/project-overview`

**Parameters:** `project` (single project key)

Generates a comprehensive project health card: suite structure, coverage metrics, recent launches, milestones, priorities, and flaky test counts. Suitable for onboarding or project reviews.

**Best for:** New team members or project health reviews.

---

## Combining Resources + Prompts

Resources and prompts work well together. Attach resource context before triggering a prompt:

**Example 1: Informed report generation**

```
@ zebrunner://projects          [attach project list]
@ zebrunner://reports/types     [attach report types]
/executive-dashboard            [trigger the workflow]
  projects: android,ios,web
```

The AI has both the project metadata and report type definitions in context, leading to more accurate tool calls.

**Example 2: Targeted triage with project context**

```
@ zebrunner://projects/MFPAND/milestones   [see available milestones]
/release-readiness                          [trigger the workflow]
  project: android
  milestone: 25.40.0
```

**Example 3: Coverage analysis with field knowledge**

```
@ zebrunner://projects/MFPIOS/fields       [see custom fields]
@ zebrunner://projects/MFPIOS/automation-states  [see automation states]
/suite-coverage
  projects: ios
```

The AI knows exactly which custom fields and automation states exist, avoiding trial-and-error.

---

## Client Compatibility

| Feature | Claude Desktop | Claude Code | Cursor | MCP Inspector |
|---------|---------------|-------------|--------|---------------|
| Static Resources (`@`) | Full support | Full support | Partial | Full support |
| Template Resources (`@`) | Full support | Full support | Partial | Full support |
| Resource autocomplete | Full support | Full support | Varies | N/A |
| Prompts (`/`) | Full support | Full support | Varies | Full support |
| Prompt arguments | Full support | Full support | Varies | Full support |

**Notes:**
- Claude Desktop and Claude Code are the primary targets and have full support.
- Cursor support depends on version — some older versions may not show resources or prompts in the UI.
- MCP Inspector is recommended for debugging and verifying that resources and prompts are registered correctly.

---

## Resource Reference Table

| Name | URI | Type | Requires API | Description |
|------|-----|------|:---:|-------------|
| Report Types | `zebrunner://reports/types` | Static | No | 6 report types with params and examples |
| Time Periods | `zebrunner://periods` | Static | No | 12 valid period values with day equivalents |
| Chart Options | `zebrunner://charts` | Static | No | Delivery formats, chart types, supported tools |
| Output Formats | `zebrunner://formats` | Static | No | 5 format families with valid values |
| Available Projects | `zebrunner://projects` | Static | Yes | All accessible projects with metadata |
| Root Suites | `zebrunner://projects/{key}/suites` | Template | Yes | Top-level suites for a project |
| Suite Hierarchy | `zebrunner://projects/{key}/suite-hierarchy` | Template | Yes | Full suite tree with parent-child |
| Automation States | `zebrunner://projects/{key}/automation-states` | Template | Yes | State names and IDs |
| Priorities | `zebrunner://projects/{key}/priorities` | Template | Yes | Priority levels and IDs |
| Milestones | `zebrunner://projects/{key}/milestones` | Template | Yes | Active and completed milestones |
| Result Statuses | `zebrunner://projects/{key}/result-statuses` | Template | Yes | Configured test run statuses |
| Config Groups | `zebrunner://projects/{key}/configuration-groups` | Template | Yes | Test run config groups and options |
| Fields Layout | `zebrunner://projects/{key}/fields` | Template | Yes | System and custom field definitions |

---

## Prompt Reference Table

| Prompt | Category | Parameters | Multi-Tool | Description |
|--------|----------|------------|:---:|-------------|
| `/pass-rate` | E2E | `projects` | Yes | Pass rate with target comparison |
| `/runtime-efficiency` | E2E | `projects` | Yes | Runtime metrics with delta |
| `/automation-coverage` | E2E | `projects` | Yes | 7-metric coverage + intake rate |
| `/executive-dashboard` | E2E | `projects` | Yes | 5-section standup-ready report |
| `/release-readiness` | E2E | `project`, `milestone?` | Yes | Go/No-Go assessment |
| `/suite-coverage` | E2E | `projects` | Yes | Per-suite coverage tables |
| `/review-test-case` | Analysis | `case_key` | Yes | Validate + improve workflow |
| `/launch-triage` | Analysis | `project` | Yes | Post-regression failure triage |
| `/flaky-review` | Analysis | `project` | Yes | Flaky test detection + plan |
| `/find-duplicates` | Analysis | `project`, `suite_id?` | Yes | Structural + semantic duplicates |
| `/daily-qa-standup` | Role | `projects` | Yes | Daily standup summary |
| `/automation-gaps` | Role | `projects` | Yes | Automation backlog prioritization |
| `/project-overview` | Role | `project` | Yes | Comprehensive project health card |

---

## Architecture (for contributors)

### File Structure

```
src/
  resources.ts       # ResourceCache class + registerResources() — 13 resources
  prompts.ts         # Prompt builders + registerPrompts() — 13 prompts
  server.ts          # Wires resources and prompts: registerResources(server, deps) + registerPrompts(server)

tests/
  unit/
    resource-registry.test.ts   # 24 tests: registration coverage, content validation, cache
    prompt-registry.test.ts     # 64 tests: registration coverage, content validation, hygiene
  eval/
    eval-prompts.ts             # 4 resource-aware eval prompts (category: "resource")
  helpers/
    tool-coverage-matrix.ts     # RESOURCE_MANIFEST (13 entries) + PROMPT_MANIFEST (13 entries)

docs/
  TEST_PROMPTS.md               # Sections 14 (Resources) and 15 (Prompts) — manual test scenarios
  RESOURCES_AND_PROMPTS.md      # This file — full usage guide
```

### Caching Strategy

Dynamic resources use an in-memory TTL cache (`ResourceCache`):

- **TTL:** 20 minutes (configurable via `DEFAULT_TTL_MS`)
- **Max entries:** 200 (LRU eviction when full)
- **Scope:** Per-server-process (resets on server restart)
- **Cache key pattern:** `{resource-type}:{project_key}` (e.g., `suites:MFPAND`)

The projects list is shared across template resources — a single `getCachedProjects()` call serves all list/complete callbacks.

### Adding New Resources

1. Add the resource registration in `src/resources.ts` inside `registerResources()`.
2. For static resources: create a `build*Content()` function (exported for testing).
3. For template resources: use `ResourceTemplate` with `list` and `complete` callbacks.
4. Add the resource to `RESOURCE_MANIFEST` in `tests/helpers/tool-coverage-matrix.ts`.
5. Update expected counts in `tests/unit/resource-registry.test.ts`.
6. Add a test scenario to `docs/TEST_PROMPTS.md` section 14.

**Static resource template:**

```typescript
server.registerResource(
  "my_resource",
  "zebrunner://my-path",
  { description: "Short description for the @ menu" },
  async () => ({
    contents: [{
      uri: "zebrunner://my-path",
      mimeType: "application/json",
      text: JSON.stringify(buildMyContent(), null, 2),
    }],
  }),
);
```

**Template resource template:**

```typescript
server.registerResource(
  "my_project_resource",
  new ResourceTemplate("zebrunner://projects/{project_key}/my-path", {
    list: projectListCallback("my-path", "My Resource Label"),
    complete: { project_key: projectKeyComplete() },
  }),
  { description: "Short description for the @ menu" },
  async (uri, { project_key }) => {
    const pk = String(project_key);
    const cacheKey = `my-path:${pk}`;
    let data = cache.get<any>(cacheKey);
    if (!data) {
      data = await fetchMyData(pk);
      cache.set(cacheKey, data);
    }
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      }],
    };
  },
);
```

### Adding New Prompts

1. Create a `build*Prompt()` function in `src/prompts.ts` (exported for testing).
2. Register the prompt with `server.registerPrompt()` inside `registerPrompts()`.
3. Add to `PROMPT_MANIFEST` in `tests/helpers/tool-coverage-matrix.ts`.
4. Update expected counts in `tests/unit/prompt-registry.test.ts`.
5. Add content validation tests for the new builder function.
6. Add a test scenario to `docs/TEST_PROMPTS.md` section 15.

**Prompt template:**

```typescript
export function buildMyPrompt(project: string): string {
  return `Instructions for the AI...

Steps:
1. Use tool_a for ${project}
2. Use tool_b for detailed analysis

Present results as a structured report.`;
}

// Inside registerPrompts():
server.registerPrompt(
  "my-prompt",
  {
    title: "My Workflow",
    description: "Short description for the / menu",
    argsSchema: {
      project: z.string().describe("Project key, e.g. 'android'"),
    },
  },
  async ({ project }) => ({
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: buildMyPrompt(project) },
    }],
  }),
);
```

### Testing

Run resource and prompt tests:

```bash
# Resource tests only
node --test --import=tsx tests/unit/resource-registry.test.ts

# Prompt tests only
node --test --import=tsx tests/unit/prompt-registry.test.ts

# All unit tests
npm run test:unit

# Type check
npx tsc --noEmit
```

The test suite validates:
- **Registration coverage** — every resource/prompt in the manifest is registered in source
- **Content correctness** — static content builders return expected structures and values
- **Cache behavior** — TTL expiry, size limits, eviction, clear
- **Prompt hygiene** — no hardcoded project keys, user arguments are interpolated
- **Prompt tool references** — each prompt mentions the tools it expects the AI to call
