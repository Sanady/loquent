import type { Ref } from "react";
import { part } from "../parts";
import { useApp } from "../storeContext";
import { THEME_LABEL, THEME_SCHEME, type ThemeId } from "../themes";
import { IconLogout, IconMoon, IconPlus, IconSidebar, IconSun } from "./icons";

export function Header({
  toggleRef,
  navId,
  navOpen,
  onToggleNav,
  theme,
  onCycleTheme,
}: {
  toggleRef?: Ref<HTMLButtonElement>;
  navId: string | null;
  navOpen: boolean;
  onToggleNav: () => void;
  theme: ThemeId;
  /** Temporary: cycles the allowed themes (Task 10 replaces it with Appearance). null hides it. */
  onCycleTheme: (() => void) | null;
}) {
  const appName = useApp((s) => s.config?.app_name ?? "");
  const logo = useApp((s) => s.config?.logo_url ?? null);
  const canLogout = useApp((s) => s.config?.auth === "password" && s.user !== null);
  const logout = useApp((s) => s.logout);
  const newThread = useApp((s) => s.newThread);
  const themeLabel = `Theme: ${THEME_LABEL[theme]}`;

  return (
    <header className="lq-header" {...part("header")}>
      {navId && (
        <button
          ref={toggleRef}
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
      <div className="lq-brand" {...part("header-title")}>
        {logo && <img src={logo} alt="" className="lq-logo" />}
        <span className="lq-brand-name">{appName}</span>
      </div>
      <div className="lq-header-actions" {...part("header-actions")}>
        {!navId && (
          <button type="button" className="lq-icon-btn" aria-label="New chat" title="New chat" onClick={newThread}>
            <IconPlus />
          </button>
        )}
        {onCycleTheme && (
          <button type="button" className="lq-icon-btn" aria-label={themeLabel} title={themeLabel} onClick={onCycleTheme}>
            {THEME_SCHEME[theme] === "dark" ? <IconMoon /> : <IconSun />}
          </button>
        )}
        {canLogout && (
          <button type="button" className="lq-icon-btn" aria-label="Sign out" title="Sign out" onClick={() => void logout()}>
            <IconLogout />
          </button>
        )}
      </div>
    </header>
  );
}
