/**
 * Credential validation helper for integration tests
 */

export interface TestCredentials {
  baseUrl: string;
  login: string;
  token: string;
}

/**
 * Check if all required credentials are available
 */
export function hasValidCredentials(): boolean {
  return !!(
    process.env.ZEBRUNNER_URL &&
    process.env.ZEBRUNNER_LOGIN &&
    process.env.ZEBRUNNER_TOKEN
  );
}

/**
 * Get test credentials from environment variables
 * Throws an error if credentials are missing
 */
export function getTestCredentials(): TestCredentials {
  const baseUrl = process.env.ZEBRUNNER_URL;
  const login = process.env.ZEBRUNNER_LOGIN;
  const token = process.env.ZEBRUNNER_TOKEN;

  if (!baseUrl || !login || !token) {
    throw new Error(
      '❌ Missing required credentials for integration tests.\n' +
      'Please set the following environment variables in your .env file:\n' +
      '  - ZEBRUNNER_URL\n' +
      '  - ZEBRUNNER_LOGIN\n' +
      '  - ZEBRUNNER_TOKEN\n\n' +
      '💡 Copy .env.example to .env and configure your Zebrunner credentials'
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''), // Remove trailing slashes
    login,
    token
  };
}

/**
 * Skip test if credentials are not available
 * Use this in test setup for optional integration tests
 */
export function skipIfNoCredentials(testName: string): void {
  if (!hasValidCredentials()) {
    console.log(`⚠️  Skipping ${testName} - no credentials available`);
    process.exit(0);
  }
}

/**
 * Require credentials or fail fast
 * Use this in test setup for mandatory integration tests
 */
export function requireCredentials(testName: string): TestCredentials {
  try {
    return getTestCredentials();
  } catch (error: any) {
    console.error(`❌ ${testName} requires valid credentials:`);
    console.error(error.message);
    process.exit(1);
  }
}
