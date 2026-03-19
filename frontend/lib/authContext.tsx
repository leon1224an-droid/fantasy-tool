/**
 * AuthContext — global auth state.
 *
 * Provides: token, user, login(), logout(), register()
 *
 * On mount: reads the stored access token, validates it by fetching /auth/me.
 * If expired (401), tries /auth/refresh (uses HttpOnly refresh cookie).
 * If refresh fails, clears state and shows login screen.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { BASE_URL } from "../constants/config";
import { tokenStorage } from "./tokenStorage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface UserProfile {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
  is_admin: boolean;
  yahoo_league_id: string | null;
  yahoo_linked: boolean;
  nba_projections_fetched_at: string | null;
}

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  /** True while the initial stored-token check is in progress */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Called by api.ts after a successful token refresh */
  _setToken: (token: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  _setToken: () => {},
});

// ---------------------------------------------------------------------------
// Low-level fetch helpers (no circular dependency with api.ts)
// ---------------------------------------------------------------------------
async function _post<T>(path: string, body: object, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    credentials: "include",   // needed for refresh-token cookie
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function _get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function _tryRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",   // sends HttpOnly refresh-token cookie
    });
    if (!res.ok) return null;
    const data: { access_token: string } = await res.json();
    return data.access_token;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const applyToken = useCallback(async (t: string): Promise<boolean> => {
    try {
      const profile = await _get<UserProfile>("/auth/me", t);
      await tokenStorage.set(t);
      setTokenState(t);
      setUser(profile);
      return true;
    } catch {
      return false;
    }
  }, []);

  // On mount: restore session from stored token
  useEffect(() => {
    (async () => {
      try {
        const stored = await tokenStorage.get();
        if (stored) {
          const ok = await applyToken(stored);
          if (!ok) {
            // Token expired — try refresh cookie
            const fresh = await _tryRefresh();
            if (fresh) await applyToken(fresh);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [applyToken]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await _post<{ access_token: string }>("/auth/login", { email, password });
    await applyToken(data.access_token);
  }, [applyToken]);

  const register = useCallback(async (email: string, username: string, password: string) => {
    // Register then immediately log in
    await _post("/auth/register", { email, username, password });
    await login(email, password);
  }, [login]);

  const logout = useCallback(async () => {
    try {
      const t = token ?? (await tokenStorage.get());
      if (t) {
        await fetch(`${BASE_URL}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${t}` },
          credentials: "include",
        });
      }
    } catch { /* best-effort */ }
    await tokenStorage.remove();
    setTokenState(null);
    setUser(null);
  }, [token]);

  const _setToken = useCallback((t: string) => {
    tokenStorage.set(t);
    setTokenState(t);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout, register, _setToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
