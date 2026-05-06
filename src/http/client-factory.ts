import { EnhancedZebrunnerClient } from '../api/enhanced-client.js';
import { ZebrunnerMutationClient } from '../api/mutation-client.js';
import { ZebrunnerReportingClient } from '../api/reporting-client.js';
import { ZebrunnerReportingToolHandlers } from '../handlers/reporting-tools.js';
import type { ZebrunnerConfig } from '../types/api.js';
import type { ZebrunnerReportingConfig } from '../types/reporting.js';
import { getCurrentContext } from './request-context.js';

const MAX_CACHED_CLIENTS = 50;
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_IDLE_MS = 30 * 60 * 1000;

export interface PerUserClients {
  client: EnhancedZebrunnerClient;
  mutationClient: ZebrunnerMutationClient;
  reportingClient: ZebrunnerReportingClient;
  reportingHandlers: ZebrunnerReportingToolHandlers;
}

interface CacheEntry {
  clients: PerUserClients;
  lastUsed: number;
}

export class ClientFactory {
  private cache = new Map<string, CacheEntry>();
  private evictionTimer: ReturnType<typeof setInterval> | undefined;
  private defaultConfig: { timeout: number; debug: boolean; defaultPageSize: number; maxPageSize: number };

  constructor(options: { timeout?: number; debug?: boolean; defaultPageSize?: number; maxPageSize?: number } = {}) {
    this.defaultConfig = {
      timeout: options.timeout ?? 60_000,
      debug: options.debug ?? false,
      defaultPageSize: options.defaultPageSize ?? 10,
      maxPageSize: options.maxPageSize ?? 100,
    };
    this.evictionTimer = setInterval(() => this.evictIdle(), EVICTION_INTERVAL_MS);
    this.evictionTimer.unref();
  }

  getOrCreate(baseUrl: string, username: string, token: string): PerUserClients {
    const key = `${username}:${token.slice(0, 8)}`;
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.clients;
    }

    if (this.cache.size >= MAX_CACHED_CLIENTS) {
      this.evictLRU();
    }

    const config: ZebrunnerConfig = {
      baseUrl,
      username,
      token,
      timeout: this.defaultConfig.timeout,
      retryAttempts: 3,
      retryDelay: 1000,
      debug: this.defaultConfig.debug,
      defaultPageSize: this.defaultConfig.defaultPageSize,
      maxPageSize: this.defaultConfig.maxPageSize,
    };

    const reportingConfig: ZebrunnerReportingConfig = {
      baseUrl: baseUrl.replace('/api/public/v1', ''),
      accessToken: token,
      timeout: this.defaultConfig.timeout,
      debug: this.defaultConfig.debug,
    };

    const client = new EnhancedZebrunnerClient(config);
    const mutationClient = new ZebrunnerMutationClient(config);
    const reportingClient = new ZebrunnerReportingClient(reportingConfig);
    const reportingHandlers = new ZebrunnerReportingToolHandlers(reportingClient, client);

    client.setAutomationStatesResolver(async (projectKey: string) => {
      const projectId = await reportingClient.getProjectId(projectKey);
      return reportingClient.getAutomationStates(projectId);
    });
    client.setPrioritiesResolver(async (projectKey: string) => {
      const projectId = await reportingClient.getProjectId(projectKey);
      return reportingClient.getPriorities(projectId);
    });

    const clients: PerUserClients = { client, mutationClient, reportingClient, reportingHandlers };
    this.cache.set(key, { clients, lastUsed: Date.now() });
    return clients;
  }

  get size(): number {
    return this.cache.size;
  }

  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.lastUsed > MAX_IDLE_MS) {
        this.cache.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.cache.clear();
  }
}

let _factory: ClientFactory | undefined;

export function getClientFactory(): ClientFactory {
  if (!_factory) {
    _factory = new ClientFactory();
  }
  return _factory;
}

export function initClientFactory(options: ConstructorParameters<typeof ClientFactory>[0]): ClientFactory {
  _factory?.destroy();
  _factory = new ClientFactory(options);
  return _factory;
}

/**
 * Create a Proxy that transparently resolves to the per-user client in HTTP mode
 * (via AsyncLocalStorage) or falls through to the singleton in STDIO mode.
 *
 * Methods are bound to the real per-user instance so that internal `this`
 * references (e.g. `this.bearerToken = …`) mutate the correct object rather
 * than leaking back to the singleton through the default Proxy `set` path.
 */
export function createClientProxy<T extends object>(
  singleton: T,
  factory: ClientFactory,
  baseUrl: string,
  selector: (clients: PerUserClients) => T,
): T {
  return new Proxy(singleton, {
    get(target, prop, receiver) {
      const ctx = getCurrentContext();
      if (ctx) {
        const perUser = factory.getOrCreate(ctx.baseUrl ?? baseUrl, ctx.username, ctx.token);
        const realTarget = selector(perUser);
        const value = Reflect.get(realTarget, prop);
        if (typeof value === 'function') {
          return value.bind(realTarget);
        }
        return value;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}
