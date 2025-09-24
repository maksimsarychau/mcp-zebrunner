import { z } from "zod";
import { ZebrunnerReportingClient } from "../api/reporting-client.js";
import { FormatProcessor } from "../utils/formatter.js";
import { GetLauncherDetailsInputSchema } from "../types/api.js";

/**
 * MCP Tool handlers for Zebrunner Reporting API
 */
export class ZebrunnerReportingToolHandlers {
  constructor(private reportingClient: ZebrunnerReportingClient) {}

  /**
   * Get launcher details tool - comprehensive launch information with test sessions
   */
  async getLauncherDetails(input: z.infer<typeof GetLauncherDetailsInputSchema>) {
    const { 
      projectKey, 
      projectId, 
      launchId, 
      includeLaunchDetails, 
      includeTestSessions, 
      format 
    } = input;

    try {
      // Validate input - either projectKey or projectId must be provided
      if (!projectKey && !projectId) {
        throw new Error("Either projectKey or projectId must be provided");
      }

      let resolvedProjectId = projectId;
      let projectInfo = null;

      // If projectKey is provided, resolve to projectId
      if (projectKey) {
        projectInfo = await this.reportingClient.getProject(projectKey);
        resolvedProjectId = projectInfo.id;
      }

      const results: any = {
        launchId,
        projectId: resolvedProjectId
      };

      // Add project info if we fetched it
      if (projectInfo) {
        results.project = projectInfo;
      }

      // Fetch launch details if requested
      if (includeLaunchDetails) {
        try {
          const launchDetails = await this.reportingClient.getLaunch(launchId, resolvedProjectId!);
          results.launch = launchDetails;
        } catch (error: any) {
          results.launchError = `Failed to fetch launch details: ${error.message}`;
        }
      }

      // Fetch test sessions if requested
      if (includeTestSessions) {
        try {
          const testSessions = await this.reportingClient.getTestSessions(launchId, resolvedProjectId!);
          results.testSessions = testSessions;
          
          // Add summary statistics
          if (testSessions.items && testSessions.items.length > 0) {
            const summary = {
              totalSessions: testSessions.items.length,
              statuses: {} as Record<string, number>,
              platforms: {} as Record<string, number>,
              browsers: {} as Record<string, number>
            };

            testSessions.items.forEach(session => {
              // Count statuses
              if (session.status) {
                summary.statuses[session.status] = (summary.statuses[session.status] || 0) + 1;
              }
              
              // Count platforms
              if (session.platform) {
                summary.platforms[session.platform] = (summary.platforms[session.platform] || 0) + 1;
              }
              
              // Count browsers
              if (session.browser) {
                summary.browsers[session.browser] = (summary.browsers[session.browser] || 0) + 1;
              }
            });

            results.testSessionsSummary = summary;
          }
        } catch (error: any) {
          results.testSessionsError = `Failed to fetch test sessions: ${error.message}`;
        }
      }

      // Format the output
      const formattedData = FormatProcessor.format(results, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };

    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving launcher details: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get launcher summary - quick overview without detailed test sessions
   */
  async getLauncherSummary(input: { projectKey?: string; projectId?: number; launchId: number; format?: 'dto' | 'json' | 'string' }) {
    const { projectKey, projectId, launchId, format = 'json' } = input;

    try {
      if (!projectKey && !projectId) {
        throw new Error("Either projectKey or projectId must be provided");
      }

      let resolvedProjectId = projectId;
      
      if (projectKey) {
        resolvedProjectId = await this.reportingClient.getProjectId(projectKey);
      }

      const launch = await this.reportingClient.getLaunch(launchId, resolvedProjectId!);
      
      // Create a summary with key information
      const summary = {
        id: launch.id,
        name: launch.name,
        status: launch.status,
        projectId: launch.projectId,
        startedAt: new Date(launch.startedAt).toISOString(),
        endedAt: launch.endedAt ? new Date(launch.endedAt).toISOString() : null,
        elapsed: launch.elapsed,
        framework: launch.framework,
        environment: launch.environment,
        platform: launch.platform,
        device: launch.device,
        build: launch.build,
        testResults: {
          passed: launch.passed || 0,
          failed: launch.failed || 0,
          skipped: launch.skipped || 0,
          blocked: launch.blocked || 0,
          aborted: launch.aborted || 0,
          total: (launch.passed || 0) + (launch.failed || 0) + (launch.skipped || 0) + (launch.blocked || 0) + (launch.aborted || 0)
        }
      };

      const formattedData = FormatProcessor.format(summary, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };

    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving launcher summary: ${error.message}`
          }
        ]
      };
    }
  }
}
