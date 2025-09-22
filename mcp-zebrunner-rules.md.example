# MCP Zebrunner Rules Configuration

This file defines rules and guidelines for enhanced test coverage analysis and draft test generation.

## 📋 Coverage Analysis Rules

### Minimum Coverage Thresholds
- **Overall Coverage**: 70%
- **Critical Steps**: 90%
- **UI Validation Steps**: 80%
- **API Validation Steps**: 85%

### Required Elements
- **UI Elements**: All user interactions must have corresponding UI element validations
- **API Calls**: All API interactions must have response validation
- **Error Handling**: Critical paths must include error case testing
- **Data Validation**: Input/output data must be validated

### Quality Standards
- **Assertions per Step**: Minimum 1 assertion per test step
- **Setup/Teardown**: Tests must have proper setup and cleanup
- **Test Isolation**: Each test must be independent
- **Naming Conventions**: Follow project-specific naming patterns

## 🧪 Test Generation Templates

### Framework Detection Patterns
```markdown
**Java/Carina Framework**:
- File patterns: `*.java`, `*Test.java`, `*Tests.java`
- Keywords: `@Test`, `extends AbstractTest`, `WebDriver`, `MobileDriver`
- Imports: `com.qaprosoft.carina`, `org.testng`, `org.junit`

**JavaScript/Jest Framework**:
- File patterns: `*.test.js`, `*.spec.js`, `*.test.ts`
- Keywords: `describe`, `it`, `expect`, `jest`
- Imports: `@testing-library`, `jest`, `cypress`

**Python/Pytest Framework**:
- File patterns: `test_*.py`, `*_test.py`
- Keywords: `def test_`, `assert`, `pytest`
- Imports: `pytest`, `unittest`, `selenium`
```

### Test Structure Templates

#### Java/Carina Template
```java
@Test(description = "{{TEST_DESCRIPTION}}")
public void {{TEST_METHOD_NAME}}() {
    // Setup
    {{SETUP_CODE}}
    
    // Test Steps
    {{#each STEPS}}
    // Step {{@index}}: {{this.action}}
    {{STEP_CODE}}
    // Validation: {{this.expectedResult}}
    {{VALIDATION_CODE}}
    {{/each}}
    
    // Cleanup
    {{TEARDOWN_CODE}}
}
```

#### JavaScript/Jest Template
```javascript
describe('{{TEST_SUITE_NAME}}', () => {
    beforeEach(() => {
        {{SETUP_CODE}}
    });
    
    it('{{TEST_DESCRIPTION}}', async () => {
        {{#each STEPS}}
        // Step {{@index}}: {{this.action}}
        {{STEP_CODE}}
        // Validation: {{this.expectedResult}}
        {{VALIDATION_CODE}}
        {{/each}}
    });
    
    afterEach(() => {
        {{TEARDOWN_CODE}}
    });
});
```

## 🎯 Code Quality Rules

### Naming Conventions
- **Test Methods**: Should describe the business scenario
- **Variables**: Use descriptive names matching domain language
- **Assertions**: Should have meaningful error messages

### Common Patterns
```markdown
**Login Actions**:
- Pattern: `loginAs{{UserType}}User()` 
- Validation: `expect(user.isAuthenticated()).toBe(true)`

**Navigation Actions**:
- Pattern: `navigateTo{{ScreenName}}()`
- Validation: `expect({{screenName}}Page.isDisplayed()).toBe(true)`

**Form Interactions**:
- Pattern: `fill{{FieldName}}(value)`
- Validation: `expect({{fieldName}}Field.getValue()).toBe(expectedValue)`
```

### Error Handling Patterns
```markdown
**API Errors**:
- Always check response status codes
- Validate error messages match expected format
- Test both success and failure scenarios

**UI Errors**:
- Validate error messages are displayed
- Check form validation behavior
- Test edge cases and boundary conditions
```

## 📱 Mobile Testing (Carina Framework)

### Mobile-Specific Rules
- **Device Compatibility**: Test on multiple screen sizes
- **Touch Interactions**: Validate tap, swipe, pinch gestures
- **App States**: Test foreground/background transitions
- **Performance**: Monitor load times and responsiveness

### Mobile Element Patterns
```java
// iOS Selectors
@FindBy(xpath = "//XCUIElementTypeButton[@name='{{BUTTON_NAME}}']")
private ExtendedWebElement {{buttonName}}Button;

// Android Selectors  
@FindBy(id = "{{RESOURCE_ID}}")
private ExtendedWebElement {{elementName}}Element;
```

## 🌐 Web Testing Patterns

### Selenium Best Practices
- **Explicit Waits**: Always use WebDriverWait instead of Thread.sleep
- **Page Object Model**: Organize elements and actions in page classes
- **Data-Driven Testing**: Use external data sources for test parameters

### Common Web Element Patterns
```java
// Wait for element to be clickable
WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
WebElement element = wait.until(ExpectedConditions.elementToBeClickable(locator));

// Validate element text
Assert.assertEquals(element.getText(), expectedText, "Element text validation failed");
```

## 🔧 Configuration Rules

### Environment-Specific Settings
- **Base URLs**: Use environment variables for different environments
- **Timeouts**: Configure appropriate timeouts for different operations
- **Retry Logic**: Implement retry mechanisms for flaky operations

### Test Data Management
- **Test Data Isolation**: Each test should use unique test data
- **Data Cleanup**: Clean up test data after test execution
- **Sensitive Data**: Never hardcode credentials or sensitive information

## 📊 Reporting and Metrics

### Required Metrics
- **Test Execution Time**: Track performance trends
- **Success Rate**: Monitor test stability
- **Coverage Reports**: Generate detailed coverage reports

### Custom Assertions
```java
// Custom assertion with detailed error message
public static void assertElementVisible(WebElement element, String elementName) {
    Assert.assertTrue(element.isDisplayed(), 
        String.format("Element '%s' should be visible but was not found", elementName));
}
```

## 🚀 Advanced Features

### Parallel Execution
- **Thread Safety**: Ensure tests can run in parallel
- **Resource Management**: Properly manage shared resources
- **Test Dependencies**: Minimize dependencies between tests

### CI/CD Integration
- **Build Integration**: Tests should integrate with build pipelines
- **Reporting**: Generate reports compatible with CI/CD systems
- **Failure Analysis**: Provide detailed failure information

---

**Note**: This file is parsed by the MCP Zebrunner server to enhance test coverage analysis and generate high-quality draft tests. Modify these rules to match your project's specific requirements and coding standards.
