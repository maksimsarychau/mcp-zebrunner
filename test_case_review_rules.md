# Test Case Writing and Review Rules for Automation

## Core Philosophy
Test cases should be written with the **"Random Person Test"** - imagine stopping a random person on the street and asking them to execute your test cases. They should be able to complete them independently from beginning to end without prior knowledge of the functionality.

## Pre-Writing Structure Rules

### 1. Hierarchical Organization
- **Rule**: Build a logical structure of Sections/Subsections tree before writing any test cases
- **Purpose**: Ensures organized, navigable test suite structure
- **Review Check**: Verify logical grouping and clear hierarchy

### 2. Naming Conventions
- **Rule**: Specify meaningful names for each Section/Subsection
- **Purpose**: Clear navigation and understanding of test scope
- **Review Check**: Names should be descriptive and follow consistent patterns

### 3. Documentation Requirements
For main sections, always include:
- **Requirements Links**: Confluence pages, Epics, Stories, Tasks
- **Visualization Links if they are available**: Figma designs, mockups, wireframes
- **Split Information**: Feature split names and treatments
- **Restrictions**: Device language, app location settings, platform-specific limitations
- **Review Check**: All referenced links are valid and accessible

## Core Test Case Writing Rules

### 4. Independence Principle
- **Rule**: Each test case must be completely independent
- **Critical**: Include ALL necessary preconditions and steps, even if repeated from previous test cases
- **Rationale**: Previous test cases may be deleted or reorganized
- **Review Check**: Can this test case be executed in isolation successfully?

### 5. Single Responsibility
- **Rule**: One specific test scenario = One test case
- **Anti-pattern**: Combining multiple test scenarios in one test case
- **Review Check**: Verify test case focuses on single, specific functionality

### 6. Template Selection
- **Rule**: Choose appropriate template based on validation needs:
  - **Simple Template**: Expected result after final step only
  - **Step-by-Step Template**: Expected result after each step
- **Review Check**: Template choice matches test case complexity and validation requirements

### 7. Title Standards
- **Rule**: Test case title should be one clear sentence expressing the main idea
- **Format**: Should communicate WHAT is being tested without reading the steps
- **Review Check**: Title alone should convey the test objective clearly

### 8. Comprehensive Preconditions
- **Rule**: NEVER skip preconditions, even if they seem obvious
- **Required Elements**:
  - Feature split name and treatment
  - Device/app language settings
  - Location settings
  - User state (logged in/out, subscription status)
  - Data prerequisites
- **Review Check**: All environmental conditions and prerequisites clearly stated

### 9. Complete Step Coverage
- **Rule**: Steps must show ALL actions from very beginning to end
- **Anti-pattern**: Starting "from the middle" or assuming context
- **Required**: Even obvious steps like "Open app", "Log in", "Navigate to tab"
- **Review Check**: Can someone with zero context follow these steps?

### 10. Visual Documentation
- **Rule**: Attach images to expected results showing important screen areas
- **Enhancement**: Use arrows to highlight specific UI elements
- **Purpose**: Eliminates ambiguity in expected results
- **Review Check**: Images are clear, relevant, and properly annotated

## Quality Assurance Rules

### 11. Attribute Management
- **Rule**: Only modify test case attributes if within your competence
- **Escalation**: Check with lead or automation team when uncertain
- **Review Check**: Attributes (priority, automation flags, etc.) are correctly set

### 12. AI-Generated Content Verification
- **Rule**: AI-generated test cases require careful human review and double-checking
- **Process**: Always read documentation before using AI assistance
- **Review Check**: AI-generated content has been thoroughly validated

### 13. Deletion vs. Archival
- **Rule**: Move uncertain-deletion test cases to "Junk" suite instead of permanent deletion
- **Process**: 
  1. Use bulk actions to clone/move
  2. Verify successful transfer
  3. Then delete originals
- **Review Check**: Important test cases are preserved appropriately

## Automation Readiness Criteria

### 14. Clear and Unambiguous Steps
- **Rule**: Each step should have only one possible interpretation
- **Review Check**: No ambiguous language or unclear actions

### 15. Consistent Data Requirements
- **Rule**: Test data requirements must be explicit and obtainable
- **Review Check**: All test data is either provided or clearly specified how to obtain

### 16. Platform Considerations
- **Rule**: Platform-specific behaviors and limitations must be documented
- **Review Check**: Cross-platform compatibility considerations addressed

## Review Process Integration

### 17. Automation Team Collaboration
- **Reference**: Follow "Review and accepting test cases for automation" process
- **Rule**: Test cases must pass automation team review before implementation
- **Review Check**: Test case meets automation team's technical requirements

## Red Flags for Review

1. **Missing Preconditions**: Any test case without explicit preconditions
2. **Vague Steps**: Steps using unclear language like "somehow", "usually", "normally"
3. **Assumption-Based Logic**: Steps that assume prior knowledge or context
4. **Missing Expected Results**: Steps without clear validation criteria
5. **Overly Complex Cases**: Single test case trying to validate multiple scenarios
6. **Broken References**: Dead links to requirements, designs, or documentation
7. **Platform Agnostic**: Test cases that don't consider platform-specific behaviors
8. **Data Dependencies**: Unclear or unavailable test data requirements

This document serves as a comprehensive guide for reviewing and ensuring high-quality test cases that meet both manual and automated testing requirements.
