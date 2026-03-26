import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { User, AuthPayload } from "../types";
import {
  getStoredToken,
  getStoredRefreshToken,
  setStoredTokens,
  clearStoredTokens,
  getClient,
  createRawClient,
} from "../api/client";
import {
  AUTHENTICATE_WITH_PAT,
  AUTHENTICATE_WITH_GITHUB_CODE,
  LOGOUT_MUTATION,
  ME_QUERY,
} from "../api/queries";

// Evaluated once at module load — never changes at runtime
const AUTH_BYPASS = import.meta.env.VITE_AUTH_BYPASS === "1";

const BYPASS_USER: User = {
  id: "dev",
  login: "dev",
  displayName: "Dev User",
};

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (pat: string) => Promise<void>;
  loginWithCode: (code: string, state: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(AUTH_BYPASS ? BYPASS_USER : null);
  const [token, setToken] = useState<string | null>(AUTH_BYPASS ? "bypass" : getStoredToken);
  const [isLoading, setIsLoading] = useState(() => AUTH_BYPASS ? false : !!getStoredToken());

  const handleAuthFailure = useCallback(() => {
    clearStoredTokens();
    setToken(null);
    setUser(null);
  }, []);

  // On mount, if we have a stored token, validate it by fetching the current user.
  // Skipped entirely when AUTH_BYPASS is active.
  useEffect(() => {
    if (AUTH_BYPASS) return;

    const storedToken = getStoredToken();
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    const client = getClient(handleAuthFailure);
    client
      .request<{ me: User }>(ME_QUERY)
      .then((result) => {
        setUser(result.me);
        // Token may have been refreshed during the request
        setToken(getStoredToken());
      })
      .catch(() => {
        handleAuthFailure();
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [handleAuthFailure]);

  const login = useCallback(
    async (pat: string) => {
      const client = createRawClient();
      const result = await client.request<{
        authenticateWithGitHubPAT: AuthPayload;
      }>(AUTHENTICATE_WITH_PAT, { token: pat });

      const { token: newToken, refreshToken, user: newUser } =
        result.authenticateWithGitHubPAT;
      setStoredTokens(newToken, refreshToken);
      setToken(newToken);
      setUser(newUser);
    },
    [],
  );

  const loginWithCode = useCallback(
    async (code: string, state: string) => {
      const client = createRawClient();
      const result = await client.request<{
        authenticateWithGitHubCode: AuthPayload;
      }>(AUTHENTICATE_WITH_GITHUB_CODE, { code, state });

      const { token: newToken, refreshToken, user: newUser } =
        result.authenticateWithGitHubCode;
      setStoredTokens(newToken, refreshToken);
      setToken(newToken);
      setUser(newUser);
    },
    [],
  );

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken && token) {
      try {
        const client = getClient();
        await client.request(LOGOUT_MUTATION, { refreshToken });
      } catch {
        // Logout is best-effort — clear local state regardless
      }
    }
    handleAuthFailure();
  }, [token, handleAuthFailure]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        loginWithCode,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
