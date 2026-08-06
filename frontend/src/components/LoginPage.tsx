import { type FormEvent, useState } from "react";
import { uiText, type Locale } from "../i18n";
import { login } from "../utils/authClient";

interface Props {
  apiBase: string;
  locale: Locale;
  onLoginSuccess: () => void;
}

export function LoginPage({ apiBase, locale, onLoginSuccess }: Props) {
  const text = uiText[locale];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError(null);

    try {
      await login(apiBase, username, password);
      onLoginSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      if (msg === "rate_limited") {
        setError(locale === "en"
          ? "Too many attempts. Try again later."
          : "嘗試次數過多，請稍後再試。");
      } else if (msg === "login_not_configured") {
        setError(locale === "en"
          ? "Login is currently unavailable. Contact the administrator."
          : "目前未完成登入設定，請聯絡管理者。"
        );
      } else if (msg === "server_error") {
        setError(locale === "en"
          ? "Server error. Please try again later."
          : "伺服器錯誤，請稍後再試。"
        );
      } else if (msg === "unauthorized") {
        setError(text.loginError);
      } else {
        setError(text.loginNetworkError);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-overlay">
      <div className="login-card">
        <h1>🔒 {text.loginTitle}</h1>
        <form onSubmit={handleSubmit} autoComplete="on">
          <div className="login-fields">
            <label>
              <span>{text.loginUsername}</span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                required
              />
            </label>
            <label>
              <span>{text.loginPassword}</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </label>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button
            type="submit"
            className="login-submit"
            disabled={loading || !username.trim() || !password}
          >
            {loading ? text.loginLoading : text.loginSubmit}
          </button>
        </form>
      </div>
    </div>
  );
}
