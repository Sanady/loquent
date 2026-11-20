import dataclasses

import pytest

import loquent
from loquent import (  # noqa: F401 - the import itself is under test
    Adapter,
    AgentError,
    App,
    FileRef,
    PublicUser,
    RunContext,
    Settings,
    WidgetAnswer,
    serve,
    ui,
)

EXPORTS = [
    "App", "serve", "Settings", "ui", "RunContext", "WidgetAnswer", "FileRef", "Adapter",
    "AgentError", "PublicUser",
]  # fmt: skip


@pytest.mark.parametrize("name", EXPORTS)
def test_public_names_importable_and_listed(name):
    assert name in loquent.__all__
    assert getattr(loquent, name) is globals()[name]


def test_exports_are_the_real_objects():
    from loquent import adapters, context

    assert loquent.Adapter is adapters.Adapter and loquent.AgentError is adapters.AgentError
    assert loquent.RunContext is context.RunContext and loquent.FileRef is context.FileRef
    assert loquent.WidgetAnswer is context.WidgetAnswer
    assert loquent.ui.Confirm is not None and callable(loquent.ui.ask)


def test_public_user_is_frozen_and_has_no_password_hash():
    u = loquent.PublicUser(id="u1", username="ann")
    assert not hasattr(u, "password_hash")
    with pytest.raises(dataclasses.FrozenInstanceError):
        u.username = "x"  # type: ignore[misc]
