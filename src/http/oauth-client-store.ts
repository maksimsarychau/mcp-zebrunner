import { randomBytes, randomUUID } from 'node:crypto';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthFlowStore, OAuthRegisteredClientRecord } from './oauth-flow-store.js';
import { filterAllowedMcpRedirectUris } from './oauth-redirect-uri-validation.js';
import { resolveMcpOAuthClient } from './mcp-client-fallback-redirects.js';

export type OAuthClientRegistrationInput = Omit<
  OAuthClientInformationFull,
  'client_id' | 'client_id_issued_at'
>;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function parseOAuthClientRegistration(client: unknown): OAuthClientRegistrationInput {
  if (!client || typeof client !== 'object') {
    throw new Error('Invalid OAuth client registration payload');
  }

  const raw = client as Record<string, unknown>;
  const redirect_uris = filterAllowedMcpRedirectUris(asStringArray(raw.redirect_uris));
  const authMethod =
    typeof raw.token_endpoint_auth_method === 'string'
      ? raw.token_endpoint_auth_method
      : 'none';

  return {
    redirect_uris: redirect_uris as OAuthClientInformationFull['redirect_uris'],
    client_name: typeof raw.client_name === 'string' ? raw.client_name : undefined,
    grant_types: asStringArray(raw.grant_types).length
      ? asStringArray(raw.grant_types)
      : ['authorization_code'],
    response_types: asStringArray(raw.response_types).length
      ? asStringArray(raw.response_types)
      : ['code'],
    token_endpoint_auth_method: authMethod,
  };
}

export function buildRegisteredClientRecord(
  clientId: string,
  input: OAuthClientRegistrationInput,
): OAuthRegisteredClientRecord {
  const authMethod = input.token_endpoint_auth_method || 'none';
  const needsSecret = authMethod !== 'none';

  return {
    client_id: clientId,
    ...(needsSecret && { client_secret: randomBytes(32).toString('hex') }),
    redirect_uris: [...input.redirect_uris].map(String),
    client_name: input.client_name,
    grant_types: [...(input.grant_types ?? ['authorization_code'])],
    response_types: [...(input.response_types ?? ['code'])],
    token_endpoint_auth_method: authMethod,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

export function toClientInformationFull(
  record: OAuthRegisteredClientRecord,
  clientSecretExpiresAt = 0,
): OAuthClientInformationFull {
  return {
    ...record,
    redirect_uris: record.redirect_uris as OAuthClientInformationFull['redirect_uris'],
    client_secret_expires_at: clientSecretExpiresAt,
  };
}

export async function getMcpRegisteredClient(
  flowStore: OAuthFlowStore,
  clientId: string,
): Promise<OAuthClientInformationFull | undefined> {
  const record = await resolveMcpOAuthClient(flowStore, clientId);
  if (!record) return undefined;
  return toClientInformationFull(record);
}

export async function registerMcpOAuthClient(
  flowStore: OAuthFlowStore,
  client: unknown,
): Promise<OAuthClientInformationFull> {
  const input = parseOAuthClientRegistration(client);
  const clientId = `mcp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const registered = buildRegisteredClientRecord(clientId, input);
  await flowStore.setClient(clientId, registered);
  return toClientInformationFull(registered);
}
