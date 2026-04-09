# Rules System Quick Reference

## 🚀 Quick Start

### Enable Rules System
```env
# Auto-enabled if mcp-zebrunner-rules.md exists with content
ENABLE_RULES_ENGINE=true
```

### Basic Usage
```bash
# Validate test case with default rules
"Validate test case MCP-123"

# Improve test case with AI suggestions
"Improve test case MCP-123"

# Generate test code with framework detection
"Generate test code for MCP-123 based on this implementation: [paste code]"

# Enhanced coverage analysis with rules
"Enhanced coverage analysis for MCP-123 with rules validation"
```

## 📋 The Three Rules Files

| File | Purpose | Used By | Key Features |
|------|---------|---------|--------------|
| `test_case_review_rules.md` | Core quality standards | `validate_test_case`, `improve_test_case` | Independence, clarity, completeness |
| `test_case_analysis_checkpoints.md` | Detailed validation checklist | `validate_test_case` | 100+ checkpoints, scoring, automation readiness |
| `mcp-zebrunner-rules.md` | Technical configuration | `generate_draft_test_by_key`, coverage analysis | Framework detection, code templates, thresholds |

## 🎯 Role-Specific Quick Commands

### Manual QA
```bash
"Validate test case MCP-123"                    # Check quality
"Improve test case MCP-123"                     # Get AI suggestions
"Check if test case MCP-123 is ready for manual execution"
```

### Test Automation Engineer
```bash
"Validate test case MCP-123 for automation readiness"
"Generate Java/Carina test for MCP-123 with this framework: [code]"
"Analyze coverage for MCP-123 against this implementation: [code]"
```

### Developer
```bash
"Get test case MCP-123 details to understand requirements"
"Analyze coverage for MCP-123 against my implementation: [code]"
"Generate unit tests for MCP-123 using Jest framework"
```

### Manager/Lead
```bash
"Get quality metrics for all test cases in project MYAPP"
"Validate all test cases in suite 18708"
"Generate team quality report"
```

## ⚙️ Customization Examples

### Mobile Project Rules
```markdown
# mobile-rules.md
## Mobile Coverage Rules
- Touch Interactions: 95%
- Device Compatibility: Multiple screen sizes
- App States: Foreground/background transitions

## Framework Detection
**Appium**: MobileDriver, AndroidDriver, IOSDriver
```

### API Project Rules
```markdown
# api-rules.md
## API Coverage Rules
- Response Validation: 100%
- Status Code Checks: All endpoints
- Error Scenarios: Each API call

## Framework Detection
**RestAssured**: given(), when(), then()
```

### Web Project Rules
```markdown
# web-rules.md
## Web Coverage Rules
- Cross-Browser: Chrome, Firefox, Safari
- Responsive: Different screen sizes
- Accessibility: WCAG compliance

## Framework Detection
**Selenium**: WebDriver, WebElement, By.
```

## 🔧 Configuration Options

### Environment Variables
```env
ENABLE_RULES_ENGINE=true              # Enable intelligent rules
MCP_RULES_FILE=custom-rules.md        # Custom technical rules
MIN_COVERAGE_THRESHOLD=70             # Coverage threshold
REQUIRE_UI_VALIDATION=true            # Require UI validation
REQUIRE_API_VALIDATION=true           # Require API validation
```

### Custom Rules Usage
```bash
# Use custom review rules
"Validate test case MCP-123 using rules from mobile-review-rules.md"

# Use custom checkpoints
"Validate test case MCP-123 with checkpoints from api-checkpoints.md"

# Use custom technical rules for generation
"Generate test for MCP-123 using mobile-technical-rules.md"
```

## 🎭 Framework Detection

### Supported Frameworks
| Framework | Detection Keywords | File Patterns | Imports |
|-----------|-------------------|---------------|---------|
| **Java/Carina** | `@Test`, `AbstractTest`, `WebDriver` | `*Test.java` | `com.qaprosoft.carina` |
| **JavaScript/Jest** | `describe`, `it`, `expect` | `*.test.js` | `@testing-library`, `jest` |
| **Python/Pytest** | `def test_`, `assert`, `pytest` | `test_*.py` | `pytest`, `unittest` |
| **Appium/Mobile** | `MobileDriver`, `AndroidDriver` | `*Test.java` | `io.appium.java_client` |
| **RestAssured/API** | `given()`, `when()`, `then()` | `*Test.java` | `io.restassured` |
| **Selenium/Web** | `WebDriver`, `WebElement` | `*Test.java` | `org.openqa.selenium` |

### Framework-Specific Generation
```bash
# Auto-detect framework
"Generate test for MCP-123 based on this code: [paste implementation]"

# Specify framework explicitly
"Generate Java/Carina test for MCP-123"
"Generate JavaScript/Jest test for MCP-123"
"Generate Python/Pytest test for MCP-123"
```

## 📊 Validation Scoring

### Score Categories
- **90-100%**: Excellent - Ready for automation
- **80-89%**: Good - Ready for manual execution, minor automation fixes needed
- **60-79%**: Needs Improvement - Requires revision before execution
- **<60%**: Poor - Requires complete rewrite

### Common Issues & Fixes
| Issue | Severity | Fix |
|-------|----------|-----|
| Missing preconditions | Critical | Add complete setup requirements |
| Vague steps | Major | Make steps specific and actionable |
| No expected results | Critical | Add clear validation criteria |
| Multiple scenarios | Major | Split into separate test cases |
| Unclear title | Minor | Make title descriptive and specific |

## 🚨 Troubleshooting

### Rules Not Loading
```bash
# Check debug logs
DEBUG=true npm run dev

# Look for: "✅ Auto-detected rules file" or "⚠️ Rules file contains no meaningful content"
```

### Framework Not Detected
```bash
# Provide more context
"Generate test for MCP-123 with this framework setup: [include imports and annotations]"

# Specify framework explicitly
"Generate Java/Carina test for MCP-123"
```

### Custom Rules Not Working
```bash
# Validate syntax
"Check my custom rules file for syntax errors"

# Use absolute path
"Validate test case MCP-123 using rules from /full/path/to/custom-rules.md"
```

## 💡 Best Practices

### 1. Start Simple
Begin with default rules, then customize gradually based on team needs.

### 2. Team Collaboration
Involve your team in rules customization for better adoption.

### 3. Version Control
Keep rules files in version control with your test cases.

### 4. Regular Updates
Review and update rules based on lessons learned.

### 5. Training Tool
Use rules system to train new team members on quality standards.

### 6. Incremental Adoption
Start with validation, then add generation and coverage analysis.

---

For complete details, see **docs/INTELLIGENT_RULES_SYSTEM.md**
