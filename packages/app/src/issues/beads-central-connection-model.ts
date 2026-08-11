const CREDENTIAL_REF_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

export function normalizeBeadsCentralEndpoint(raw: string): string | null {
  try {
    const endpoint = new URL(raw.trim());
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return null;
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    endpoint.pathname = endpoint.pathname.replace(/\/+$/u, "");
    return endpoint.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

export function normalizeBeadsCentralCredentialRef(raw: string): string | null {
  const credentialRef = raw.trim();
  return CREDENTIAL_REF_PATTERN.test(credentialRef) ? credentialRef : null;
}

export function validateBeadsCentralToken(raw: string): boolean {
  const token = raw.trim();
  return token.length === 0 || token.length >= 32;
}
