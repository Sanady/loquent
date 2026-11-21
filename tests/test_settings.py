import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from loquent.settings import COLOR_TOKENS, THEME_IDS, Settings

THEMES_TS = Path(__file__).resolve().parent.parent / "frontend" / "src" / "themes.ts"


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("LOQUENT_PORT", "9001")
    monkeypatch.setenv("LOQUENT_AUTH", "password")
    monkeypatch.setenv("LOQUENT_API_KEY", "sk-secret-123")
    monkeypatch.setenv("LOQUENT_CORS_ORIGINS", '["http://a.test","http://b.test"]')
    monkeypatch.setenv("LOQUENT_HIDE", '["thread_list"]')
    s = Settings()
    assert s.port == 9001
    assert s.auth == "password"
    assert s.api_key.get_secret_value() == "sk-secret-123"
    assert s.cors_origins == ["http://a.test", "http://b.test"]
    assert s.hide == ["thread_list"]


def test_defaults():
    s = Settings()
    assert s.app_name == "Chat"
    assert s.host == "127.0.0.1"
    assert s.auth == "none"
    assert s.max_upload_mb == 20
    assert "application/pdf" in s.allowed_upload_types


def test_secrets_not_in_repr():
    s = Settings(api_key="sk-supersecret", secret_key="key-supersecret")
    for text in (repr(s), str(s), repr(s.api_key), str(s.secret_key), s.model_dump_json()):
        assert "supersecret" not in text


def test_effective_secret():
    assert Settings(secret_key="abc").effective_secret() == "abc"
    s = Settings()
    k = s.effective_secret()
    assert len(k) >= 32 and s.effective_secret() == k
    assert Settings().effective_secret() != k


def test_widgets_setting_defaults_true_and_reads_env(monkeypatch):
    assert Settings().widgets is True
    monkeypatch.setenv("LOQUENT_WIDGETS", "false")
    assert Settings().widgets is False


def test_theme_setting_defaults():
    s = Settings()
    assert s.default_theme == "system"
    assert s.themes == ["graphite", "graphite-dark", "editorial", "midnight"]
    assert s.allow_user_css is True
    assert s.allow_user_prefs is True
    assert s.lock_tokens == []
    assert s.max_user_css_kb == 64


def test_theme_settings_read_env(monkeypatch):
    monkeypatch.setenv("LOQUENT_DEFAULT_THEME", "midnight")
    monkeypatch.setenv("LOQUENT_THEMES", '["midnight", "graphite"]')
    monkeypatch.setenv("LOQUENT_LOCK_TOKENS", '["accent", "bg"]')
    monkeypatch.setenv("LOQUENT_ALLOW_USER_CSS", "false")
    s = Settings()
    assert s.default_theme == "midnight"
    assert s.themes == ["midnight", "graphite"]
    assert s.lock_tokens == ["accent", "bg"]
    assert s.allow_user_css is False


def test_themes_must_be_known_and_nonempty():
    with pytest.raises(ValidationError, match="themes"):
        Settings(themes=[])
    with pytest.raises(ValidationError, match="solarized"):
        Settings(themes=["graphite", "solarized"])
    with pytest.raises(ValidationError, match="themes"):
        Settings(themes=["graphite", "graphite"])
    assert Settings(themes=["midnight"], default_theme="midnight").themes == ["midnight"]


def test_default_theme_must_be_allowed():
    with pytest.raises(ValidationError, match="default_theme"):
        Settings(default_theme="midnight", themes=["graphite", "editorial"])
    with pytest.raises(ValidationError):
        Settings(default_theme="solarized")
    assert Settings(default_theme="system", themes=["editorial"]).default_theme == "system"
    assert Settings(default_theme="editorial", themes=["editorial"]).default_theme == "editorial"


def test_lock_tokens_must_be_color_tokens():
    assert Settings(lock_tokens=["accent", "user-bubble"]).lock_tokens == ["accent", "user-bubble"]
    with pytest.raises(ValidationError, match="radius-lg"):
        Settings(lock_tokens=["accent", "radius-lg"])
    with pytest.raises(ValidationError, match="--lq-accent"):
        Settings(lock_tokens=["--lq-accent"])


def test_max_user_css_kb_positive():
    with pytest.raises(ValidationError):
        Settings(max_user_css_kb=0)


def test_theme_ids_and_color_tokens_match_the_frontend():
    # The UI's themes.ts is the source; the server validates against a copy of its lists.
    src = THEMES_TS.read_text(encoding="utf-8")

    def ts_list(name: str) -> list[str]:
        body = re.search(rf"export const {name} = \[(.*?)\] as const", src, re.DOTALL)
        assert body, name
        return re.findall(r'"([a-z-]+)"', body.group(1))

    assert list(THEME_IDS) == ts_list("THEMES")
    assert list(COLOR_TOKENS) == ts_list("COLOR_TOKENS")
