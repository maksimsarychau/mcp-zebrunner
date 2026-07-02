/** Redact API keys and tokens before writing eval logs to stderr. */

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[a-zA-Z0-9_-]{8,}\b/g,
  /\bsk-[a-zA-Z0-9_-]{8,}\b/g,
  /\bAIza[a-zA-Z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
  /\b(x-zebrunner-api-token|x-zebrunner-token):\s*\S+/gi,
];

export function maskSecret(value: string | undefined, visibleTail = 4): string {
  if (!value) return "(empty)";
  if (value.length <= visibleTail) return "***";
  return `***${value.slice(-visibleTail)}`;
}

/** Strip likely secrets from free-form log lines (eval stderr only). */
export function redactSecretsInString(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function evalSafeStderr(message: string): void {
  console.error(redactSecretsInString(message));
}
