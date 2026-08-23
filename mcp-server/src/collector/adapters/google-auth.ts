/**
 * Shared Google OAuth 2.0 helper for all Google service adapters.
 *
 * Handles:
 *   - OAuth2 client creation from credentials
 *   - Token refresh
 *   - Shared client instance across Gmail, Calendar, Drive adapters
 *
 * Setup flow (user performs once):
 *   1. Create a Google Cloud project + enable Gmail, Calendar, Drive APIs
 *   2. Create OAuth 2.0 credentials (Desktop app type)
 *   3. Run the auth helper to get a refresh token
 *   4. Store client_id, client_secret, refresh_token in adapter config
 *
 * The refresh_token is stored encrypted in the collector config.
 */

// Type-only interface — actual googleapis loaded dynamically
export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

let cachedAuth: any = null;
let cachedConfig: GoogleAuthConfig | null = null;

/**
 * Get or create a Google OAuth2 client.
 * Reuses the same client across all Google adapters to avoid duplicate token refreshes.
 */
export async function getGoogleAuth(config: GoogleAuthConfig): Promise<any> {
  // Reuse if same credentials
  if (
    cachedAuth &&
    cachedConfig &&
    cachedConfig.clientId === config.clientId &&
    cachedConfig.refreshToken === config.refreshToken
  ) {
    return cachedAuth;
  }

  const { google } = await import("googleapis");

  const oauth2 = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    "urn:ietf:wg:oauth:2.0:oob" // Desktop redirect URI
  );

  oauth2.setCredentials({
    refresh_token: config.refreshToken,
  });

  // Force an initial token refresh to validate credentials
  try {
    await oauth2.getAccessToken();
  } catch (err: any) {
    throw new Error(
      `Google OAuth failed: ${err.message}. ` +
        "Ensure client_id, client_secret, and refresh_token are correct. " +
        "You may need to re-authorize if the refresh token has been revoked."
    );
  }

  cachedAuth = oauth2;
  cachedConfig = config;
  return oauth2;
}

/**
 * Extract Google auth config from adapter settings.
 * Validates required fields are present.
 */
export function extractGoogleAuthConfig(
  settings: Record<string, any>
): GoogleAuthConfig {
  const clientId = settings.google_client_id || settings.clientId;
  const clientSecret = settings.google_client_secret || settings.clientSecret;
  const refreshToken = settings.google_refresh_token || settings.refreshToken;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google adapter requires google_client_id, google_client_secret, and google_refresh_token in settings. " +
        "See README for setup instructions."
    );
  }

  return { clientId, clientSecret, refreshToken };
}

/**
 * Clear cached auth (call on destroy).
 */
export function clearGoogleAuth(): void {
  cachedAuth = null;
  cachedConfig = null;
}
