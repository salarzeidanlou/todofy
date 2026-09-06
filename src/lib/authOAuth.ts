const OAUTH_PROTOCOL = "todofy:";
const OAUTH_HOST = "auth-callback";

/**
 * Extract a Supabase PKCE authorization code from todofy's exact callback URL.
 * Other deep links belong to other app features and are ignored. Token-bearing
 * fragments are rejected so an arbitrary deep link can never install a session.
 */
export function parseOAuthCallback(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== OAUTH_PROTOCOL ||
    url.hostname !== OAUTH_HOST ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    return null;
  }

  if (url.hash || url.searchParams.has("access_token") || url.searchParams.has("refresh_token")) {
    throw new Error("Rejected a token-bearing OAuth callback; PKCE code exchange is required.");
  }

  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) throw new Error(providerError);

  const code = url.searchParams.get("code");
  if (!code) throw new Error("Google sign-in returned without an authorization code.");
  return code;
}
