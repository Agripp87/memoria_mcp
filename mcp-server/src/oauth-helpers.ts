/**
 * Pure OAuth helper functions, extracted from http.ts so they can be unit
 * tested without the server's import-time side effects (token DB, store,
 * required MEMORIA_API_KEY). http.ts wraps these with its configured values.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Whether a redirect_uri is permitted: https (or http on localhost) AND the
 * host is an allowlisted host or a subdomain of one. The authorization code is
 * delivered to redirect_uri, so an over-broad match lets anyone exfiltrate
 * codes.
 *
 * The scheme is checked for local hosts too. Before 2026-09, a local host was
 * exempt from the scheme check entirely, so `javascript://localhost/...` or any
 * custom scheme with a localhost authority was issued a code.
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
  // https everywhere; plaintext http only for a loopback callback.
  const schemeOk = url.protocol === "https:" || (isLocal && url.protocol === "http:");
  if (!schemeOk) return false;
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Constant-time string comparison. Compares UTF-8 BYTE lengths, not string
 * lengths: timingSafeEqual throws a RangeError on unequal-length buffers, and a
 * non-ASCII string has more bytes than characters, so a character-count check
 * let a crafted value of the right length through to a throw — a 500 with a
 * stack trace instead of a 401. The early return leaks only length.
 */
export function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Constant-time comparison of provided client credentials against expected
 * values. Anything but a string counts as missing: a JSON body can carry an
 * object here, and String() on `{"toString": 1}` throws.
 */
export function validateClientCredentials(
  clientId: unknown,
  clientSecret: unknown,
  expectedId: string,
  expectedSecret: string,
): boolean {
  const id = typeof clientId === "string" ? clientId : "";
  const secret = typeof clientSecret === "string" ? clientSecret : "";
  // Evaluate both so a wrong id costs the same time as a wrong secret.
  const idMatch = safeEqual(id, expectedId);
  const secretMatch = safeEqual(secret, expectedSecret);
  return idMatch && secretMatch;
}
