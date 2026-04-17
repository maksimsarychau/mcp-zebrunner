import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  username: string;
  token: string;
  baseUrl?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getCurrentContext(): RequestContext | undefined {
  return requestContext.getStore();
}
