import type { ColorMode } from "../theme";
import { useApp } from "../storeContext";
import { IconLogout, IconMoon, IconPlus, IconSidebar, IconSun } from "./icons";

export function Header({
  navId,
  navOpen,
  onToggleNav,
  mode,
  onToggleMode,
}: {
  navId: string | null;
  navOpen: boolean;
  onToggleNav: () => void;
  mode: ColorMode;
  onToggleMode: () => void;
}) {
  const appName = useApp((s) => s.config?.app_name ?? "");
  const logo = useApp((s) => s.config?.logo_url ?? null);
  const canLogout = useApp((s) => s.config?.auth === "password" && s.user !== null);
  const logout = useApp((s) => s.logout);
  const newThread = useApp((s) => s.newThread);
  const next = mode === "dark" ? "light" : "dark";

  return (
    <header className="lq-header">
      {navId && (
        <button
          type="button"
          className="lq-icon-btn"
          aria-label={navOpen ? "Hide chats" : "Show chats"}
          title={navOpen ? "Hide chats" : "Show chats"}
          aria-expanded={navOpen}
          aria-controls={navId}
          onClick={onToggleNav}
        >
          <IconSidebar />
        </button>
      )}
      <div className="lq-brand">
        {logo && <img src={logo} alt="" className="lq-logo" />}
        <span className="lq-brand-name">{appName}</span>
      </div>
      <div className="lq-header-actions">
        {!navId && (
          <button type="button" className="lq-icon-btn" aria-label="New chat" title="New chat" onClick={newThread}>
            <IconPlus />
          </button>
        )}
        <button type="button" className="lq-icon-btn" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} onClick={onToggleMode}>
          {mode === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        {canLogout && (
          <button type="button" className="lq-icon-btn" aria-label="Sign out" title="Sign out" onClick={() => void logout()}>
            <IconLogout />
          </button>
        )}
      </div>
    </header>
  );
}
