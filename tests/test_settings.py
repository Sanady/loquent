from loquent.settings import Settings


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
