/**
 * Utility functions for generating clickable links to Zebrunner web UI
 */

export interface ClickableLinkOptions {
  includeClickableLinks?: boolean;
  baseWebUrl?: string;
}

/**
 * Transform API URL to web UI URL
 * @param apiUrl - The API URL (e.g., "https://<your-project>.zebrunner.com/api/public/v1")
 * @returns Web UI base URL (e.g., "https://<your-project>.zebrunner.com")
 */
export function transformApiUrlToWebUrl(apiUrl: string): string {
  if (!apiUrl) return '';
  
  try {
    // Remove /api/public/v1 suffix and any trailing slashes
    return apiUrl.replace(/\/api\/public\/v1\/?$/, '').replace(/\/+$/, '');
  } catch (error) {
    console.error('Failed to transform API URL to web URL:', error);
    return '';
  }
}

/**
 * Generate clickable link for a test case
 * @param projectKey - Project key (e.g., "MCP")
 * @param testCaseKey - Test case key (e.g., "MCP-1")
 * @param testCaseId - Test case ID (e.g., 82651)
 * @param baseWebUrl - Base web URL (e.g., "https://<your-project>.zebrunner.com")
 * @param options - Link generation options
 * @returns Clickable markdown link or just the key if links disabled
 */
export function generateTestCaseLink(
  projectKey: string,
  testCaseKey: string,
  testCaseId?: number,
  baseWebUrl?: string,
  options: ClickableLinkOptions = {}
): string {
  if (!options.includeClickableLinks || !baseWebUrl || !testCaseId) {
    return testCaseKey;
  }
  
  try {
    const url = `${baseWebUrl}/projects/${projectKey}/test-cases?caseId=${testCaseId}`;
    return `[${testCaseKey}](${url})`;
  } catch (error) {
    console.error('Failed to generate test case link:', error);
    return testCaseKey;
  }
}

/**
 * Generate clickable link for a test suite
 * @param projectKey - Project key (e.g., "MCP")
 * @param suiteName - Suite name for display
 * @param suiteId - Suite ID (e.g., 18822)
 * @param baseWebUrl - Base web URL (e.g., "https://<your-project>.zebrunner.com")
 * @param options - Link generation options
 * @returns Clickable markdown link or just the suite name if links disabled
 */
export function generateSuiteLink(
  projectKey: string,
  suiteName: string,
  suiteId: number,
  baseWebUrl?: string,
  options: ClickableLinkOptions = {}
): string {
  if (!options.includeClickableLinks || !baseWebUrl) {
    return suiteName;
  }
  
  try {
    const url = `${baseWebUrl}/projects/${projectKey}/test-cases?suiteId=${suiteId}`;
    return `[${suiteName}](${url})`;
  } catch (error) {
    console.error('Failed to generate suite link:', error);
    return suiteName;
  }
}

/**
 * Add web URL field to test case object for JSON/DTO outputs
 * @param testCase - Test case object
 * @param projectKey - Project key
 * @param baseWebUrl - Base web URL
 * @param options - Link generation options
 * @returns Enhanced test case with webUrl field
 */
export function addTestCaseWebUrl(
  testCase: any,
  projectKey: string,
  baseWebUrl?: string,
  options: ClickableLinkOptions = {}
): any {
  if (!options.includeClickableLinks || !baseWebUrl || !testCase.id) {
    return testCase;
  }
  
  try {
    const webUrl = `${baseWebUrl}/projects/${projectKey}/test-cases?caseId=${testCase.id}`;
    return {
      ...testCase,
      webUrl
    };
  } catch (error) {
    console.error('Failed to add web URL to test case:', error);
    return testCase;
  }
}

/**
 * Add web URL field to test suite object for JSON/DTO outputs
 * @param testSuite - Test suite object
 * @param projectKey - Project key
 * @param baseWebUrl - Base web URL
 * @param options - Link generation options
 * @returns Enhanced test suite with webUrl field
 */
export function addSuiteWebUrl(
  testSuite: any,
  projectKey: string,
  baseWebUrl?: string,
  options: ClickableLinkOptions = {}
): any {
  if (!options.includeClickableLinks || !baseWebUrl || !testSuite.id) {
    return testSuite;
  }
  
  try {
    const webUrl = `${baseWebUrl}/projects/${projectKey}/test-cases?suiteId=${testSuite.id}`;
    return {
      ...testSuite,
      webUrl
    };
  } catch (error) {
    console.error('Failed to add web URL to test suite:', error);
    return testSuite;
  }
}

/**
 * Get clickable link configuration from environment and options
 * @param includeClickableLinks - User preference for clickable links
 * @param apiUrl - API URL from environment
 * @returns Clickable link options with base web URL
 */
export function getClickableLinkConfig(
  includeClickableLinks: boolean = false,
  apiUrl?: string
): ClickableLinkOptions {
  const baseWebUrl = apiUrl ? transformApiUrlToWebUrl(apiUrl) : undefined;
  
  return {
    includeClickableLinks,
    baseWebUrl
  };
}
