export interface VerifiedBearerCredentials {
  username: string;
  zebrunnerToken: string;
  baseUrl?: string;
}

const MAX_USERNAME_LEN = 320;
const MAX_TOKEN_LEN = 4096;
const MAX_BASE_URL_LEN = 2048;

/**
 * Validate fields returned by OAuth bearer verification before attaching to req.auth.
 */
export function validateVerifiedBearerCredentials(
  creds: VerifiedBearerCredentials,
): VerifiedBearerCredentials {
  const username = creds.username?.trim();
  const zebrunnerToken = creds.zebrunnerToken?.trim();
  const baseUrl = creds.baseUrl?.trim();

  if (!username || username.length > MAX_USERNAME_LEN) {
    throw new Error("Invalid bearer auth: username");
  }
  if (!zebrunnerToken || zebrunnerToken.length > MAX_TOKEN_LEN) {
    throw new Error("Invalid bearer auth: zebrunner token");
  }
  if (baseUrl !== undefined && baseUrl !== "") {
    if (baseUrl.length > MAX_BASE_URL_LEN) {
      throw new Error("Invalid bearer auth: baseUrl");
    }
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error("Invalid bearer auth: baseUrl");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid bearer auth: baseUrl protocol");
    }
  }

  return {
    username,
    zebrunnerToken,
    ...(baseUrl ? { baseUrl } : {}),
  };
}
