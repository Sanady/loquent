import { useState, type FormEvent } from "react";
import { part } from "../parts";
import { useApp } from "../storeContext";

export function Login() {
  const appName = useApp((s) => s.config?.app_name ?? "");
  const logo = useApp((s) => s.config?.logo_url ?? null);
  const authError = useApp((s) => s.authError);
  const login = useApp((s) => s.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await login(username, password);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="lq-login" {...part("login")}>
      <form className="lq-login-card" onSubmit={onSubmit} aria-labelledby="lq-login-title">
        <div className="lq-login-brand">
          {logo && <img src={logo} alt="" className="lq-logo" />}
          <span className="lq-brand-name">{appName}</span>
        </div>
        <h1 id="lq-login-title">Sign in</h1>
        {authError && (
          <p className="lq-login-error" role="alert">
            {authError}
          </p>
        )}
        <label className="lq-field">
          <span>Username</span>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="lq-field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" className="lq-btn lq-btn-primary lq-btn-block" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
