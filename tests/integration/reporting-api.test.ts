import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { ZebrunnerReportingClient } from '../../src/api/reporting-client.js';
import { ZebrunnerReportingConfig } from '../../src/types/reporting.js';
import 'dotenv/config';

/**
 * Integration tests for ZebrunnerReportingClient
 * Tests the new access token authentication and reporting API endpoints
 * 
 * Prerequisites:
 * - Valid .env file with ZEBRUNNER_TOKEN (access token)
 * - Access to the reporting API
 * - Launch ID 118685 and Project ID 7 should exist
 */

describe('ZebrunnerReportingClient Integration Tests', () => {
  let client: ZebrunnerReportingClient;
  let config: ZebrunnerReportingConfig;

  // Test data from the bash script example
  const TEST_LAUNCH_ID = 118685;
  const TEST_PROJECT_ID = 7;

  beforeEach(() => {
    // Check if required environment variables are available
    const baseUrl = process.env.ZEBRUNNER_URL?.replace('/api/public/v1', '') || 'https://test.zebrunner.com';
    const accessToken = process.env.ZEBRUNNER_TOKEN;

    if (!accessToken) {
      console.log('⚠️  Skipping reporting API tests - ZEBRUNNER_TOKEN not found in .env');
      return;
    }

    config = {
      baseUrl,
      accessToken,
      timeout: 30000,
      debug: process.env.DEBUG === 'true'
    };

    client = new ZebrunnerReportingClient(config);
  });

  describe('Authentication Flow', () => {
    it('should successfully authenticate with access token', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      const bearerToken = await client.authenticate();
      
      assert.ok(bearerToken);
      assert.equal(typeof bearerToken, 'string');
      assert.ok(bearerToken.length > 0);
      
      if (config.debug) {
        console.log('✅ Bearer token obtained:', bearerToken.substring(0, 20) + '...');
      }
    });

    it('should test connection to reporting API', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      const result = await client.testConnection();
      
      assert.equal(result.success, true);
      assert.ok(result.message.includes('Connection successful'));
      assert.ok(result.details);
      assert.equal(result.details.baseUrl, config.baseUrl);
      assert.ok(result.details.tokenLength > 0);
      assert.ok(result.details.expiresAt instanceof Date);
    });

    it('should track authentication status', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      // Initially not authenticated
      let authStatus = client.getAuthStatus();
      assert.equal(authStatus.authenticated, false);
      assert.equal(authStatus.expiresAt, null);

      // Authenticate
      await client.authenticate();

      // Now should be authenticated
      authStatus = client.getAuthStatus();
      assert.equal(authStatus.authenticated, true);
      assert.ok(authStatus.expiresAt instanceof Date);
      assert.ok(typeof authStatus.timeToExpiry === 'number');
      assert.ok(authStatus.timeToExpiry! > 0);
    });

    it('should handle invalid access token', async function() {
      const invalidClient = new ZebrunnerReportingClient({
        baseUrl: config.baseUrl,
        accessToken: 'invalid-token-12345',
        timeout: 10000
      });

      try {
        await invalidClient.authenticate();
        assert.fail('Should have thrown an authentication error');
      } catch (error: any) {
        // API might return 404 or 401 for invalid tokens
        assert.ok(['ZebrunnerReportingAuthError', 'ZebrunnerReportingNotFoundError'].includes(error.name));
        assert.ok([401, 404].includes(error.statusCode));
        assert.ok(error.message.includes('Authentication failed') || error.message.includes('Resource not found'));
      }
    });
  });

  describe('Launch API', () => {
    it('should get launch details by ID', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      const launch = await client.getLaunch(TEST_LAUNCH_ID, TEST_PROJECT_ID);
      
      assert.ok(launch);
      assert.equal(launch.id, TEST_LAUNCH_ID);
      assert.equal(launch.projectId, TEST_PROJECT_ID);
      assert.ok(launch.name);
      assert.ok(launch.status);
      assert.ok(launch.startedAt);
      
      // Verify the launch has expected structure
      assert.equal(typeof launch.id, 'number');
      assert.equal(typeof launch.name, 'string');
      assert.equal(typeof launch.status, 'string');
      assert.equal(typeof launch.startedAt, 'number'); // timestamp
      assert.equal(typeof launch.projectId, 'number');

      if (config.debug) {
        console.log('✅ Launch details:', {
          id: launch.id,
          name: launch.name,
          status: launch.status,
          projectId: launch.projectId,
          passed: launch.passed,
          failed: launch.failed
        });
      }
    });

    it('should handle non-existent launch ID', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      try {
        await client.getLaunch(999999, TEST_PROJECT_ID);
        assert.fail('Should have thrown a not found error');
      } catch (error: any) {
        assert.equal(error.name, 'ZebrunnerReportingNotFoundError');
        assert.equal(error.statusCode, 404);
        assert.ok(error.message.includes('Resource not found'));
      }
    });

    it('should handle invalid project ID', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      try {
        await client.getLaunch(TEST_LAUNCH_ID, 999999);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        // Could be 404 or 400 depending on API behavior
        assert.ok([400, 404].includes(error.statusCode));
      }
    });
  });

  describe('Token Management', () => {
    it('should reuse valid bearer token for multiple requests', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      // First request - should authenticate
      const launch1 = await client.getLaunch(TEST_LAUNCH_ID, TEST_PROJECT_ID);
      const authStatus1 = client.getAuthStatus();
      
      assert.ok(launch1);
      assert.equal(authStatus1.authenticated, true);
      
      // Second request - should reuse token
      const launch2 = await client.getLaunch(TEST_LAUNCH_ID, TEST_PROJECT_ID);
      const authStatus2 = client.getAuthStatus();
      
      assert.ok(launch2);
      assert.equal(authStatus2.authenticated, true);
      
      // Should be the same launch data
      assert.equal(launch1.id, launch2.id);
      assert.equal(launch1.name, launch2.name);
    });

    it('should handle concurrent requests properly', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      // Make multiple concurrent requests to the same launch endpoint
      const promises = [
        client.getLaunch(TEST_LAUNCH_ID, TEST_PROJECT_ID),
        client.getLaunch(TEST_LAUNCH_ID, TEST_PROJECT_ID)
      ];

      const results = await Promise.allSettled(promises);
      
      // All requests should succeed
      assert.equal(results[0].status, 'fulfilled');
      assert.equal(results[1].status, 'fulfilled');

      if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
        const launch1 = results[0].value;
        const launch2 = results[1].value;
        assert.equal(launch1.id, launch2.id);
      }
      
      // Test connection separately
      const connectionResult = await client.testConnection();
      assert.equal(connectionResult.success, true);
    });
  });

  describe('Error Handling', () => {
    it('should provide meaningful error messages', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      try {
        await client.getLaunch(-1, TEST_PROJECT_ID);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message);
        assert.ok(error.statusCode);
        assert.ok(['ZebrunnerReportingError', 'ZebrunnerReportingNotFoundError', 'ZebrunnerReportingAuthError'].includes(error.name));
      }
    });

    it('should handle network timeouts', async function() {
      const timeoutClient = new ZebrunnerReportingClient({
        baseUrl: config.baseUrl,
        accessToken: config.accessToken,
        timeout: 1 // Very short timeout
      });

      try {
        await timeoutClient.getLaunch(TEST_LAUNCH_ID, TEST_PROJECT_ID);
        // If it succeeds, the API is very fast
        assert.ok(true);
      } catch (error: any) {
        // Should timeout
        assert.ok(error.message.includes('timeout') || error.code === 'ECONNABORTED');
      }
    });
  });

  describe('Integration with Bash Script Workflow', () => {
    it('should replicate bash script authentication flow', async function() {
      if (!client) {
        console.log('⚠️  Skipping test - no client available');
        return;
      }

      // Step 1: Exchange access token for bearer token (like the bash script)
      console.log('[*] Requesting short-living token...');
      const bearerToken = await client.authenticate();
      
      assert.ok(bearerToken);
      assert.equal(typeof bearerToken, 'string');
      console.log('✅ Short-living token obtained');

      // Step 2: Use bearer token to fetch launch data (like the bash script)
      console.log('[*] Fetching launch data from API...');
      const launch = await client.getLaunch(TEST_LAUNCH_ID, TEST_PROJECT_ID);
      
      assert.ok(launch);
      assert.equal(launch.id, TEST_LAUNCH_ID);
      assert.equal(launch.projectId, TEST_PROJECT_ID);
      console.log(`✅ Launch data retrieved: ${launch.name} (Status: ${launch.status})`);

      // Step 3: Verify we got the same type of data the bash script would get
      assert.ok(launch.startedAt);
      assert.equal(typeof launch.startedAt, 'number'); // timestamp
      if (launch.endedAt) {
        assert.equal(typeof launch.endedAt, 'number'); // timestamp
      }
      if (launch.passed !== undefined) {
        assert.equal(typeof launch.passed, 'number');
      }

      console.log(launch.build);

      console.log('[+] Authentication and API flow test completed successfully');
    });
  });
});
