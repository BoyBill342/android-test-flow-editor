/**
 * Auth client utilities.
 *
 * Tokens are stored in sessionStorage — NOT localStorage — so they are
 * automatically cleared when the browser tab/window closes, reducing the
 * exposure window for XSS-based token theft.
 *
 * NEVER log token values or credentials anywhere in this module.
 */

const TOKEN_KEY = "adb-editor-token";

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

function removeToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function clearAuthSession(): void {
  removeToken();
}

// ---------------------------------------------------------------------------
// Token inspection (client-side expiry check, no signature verification)
// ---------------------------------------------------------------------------

export function isLoggedIn(): boolean {
  return !!getToken();
}

// ---------------------------------------------------------------------------
// Auth headers for fetch calls
// ---------------------------------------------------------------------------

export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

export async function login(apiBase: string, username: string, password: string): Promise<void> {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (response.status === 429) {
    throw new Error("rate_limited");
  }
  if (response.status === 503) {
    throw new Error("login_not_configured");
  }
  if (response.status >= 500) {
    throw new Error("server_error");
  }
  if (!response.ok) {
    throw new Error("unauthorized");
  }

  const data = (await response.json()) as { access_token: string };
  setToken(data.access_token);
}

export async function logout(apiBase: string): Promise<void> {
  const token = getToken();
  removeToken();
  if (token) {
    // Best-effort: revoke the session token on the server so it can't be reused.
    fetch(`${apiBase}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => { /* ignore network errors on logout */ });
  }
}
