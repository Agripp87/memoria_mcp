/**
 * Pure OAuth helper functions, extracted from http.ts so they can be unit
 * tested without the server's import-time side effects (token DB, store,
 * required MEMORIA_API_KEY). http.ts wraps these with its configured values.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Whether a redirect_uri is permitted: https (or localhost) AND the host is an
 * allowlisted host or a subdomain of one. The authorization code is delivered
 * to redirect_uri, so an over-broad match lets anyone exfiltrate codes.
 */
export function isAllowedRedirect(uri: string, allowedHosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  // Require https for anything non-local to prevent code leakage over plaintext.
  if (!isLocal && url.protocol !== "https:") return false;
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Constant-time comparison of provided client credentials against expected
 * values. Length is checked first because timingSafeEqual throws on
 * unequal-length buffers; the early return leaks only length, not content.
 */
export function validateClientCredentials(
  clientId: unknown,
  clientSecret: unknown,
  expectedId: string,
  expectedSecret: string,
): boolean {
  const id = String(clientId ?? "");
  const secret = String(clientSecret ?? "");
  const idMatch =
    id.length === expectedId.length && timingSafeEqual(Buffer.from(id), Buffer.from(expectedId));
  const secretMatch =
    secret.length === expectedSecret.length &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(expectedSecret));
  return idMatch && secretMatch;
}
