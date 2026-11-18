import pytest

from loquent.adapters.agui_http import AgUiHttpAdapter
from loquent.adapters.function import FunctionAdapter
from loquent.adapters.openai_compat import OpenAICompatAdapter
from loquent.adapters.resolve import resolve_agent


def test_resolve_adapter_instance_returned_as_is():
    a = FunctionAdapter(lambda messages: "x")
    assert resolve_agent(a) is a


def test_resolve_url_with_model_is_openai_compat():
    a = resolve_agent("https://api.x.com/v1", model="gpt-4o", api_key="k")
    assert isinstance(a, OpenAICompatAdapter)


def test_resolve_url_without_model_is_agui_http():
    assert isinstance(resolve_agent("http://localhost:8000/agent"), AgUiHttpAdapter)


def test_resolve_callable_is_function_adapter():
    assert isinstance(resolve_agent(lambda messages: "x"), FunctionAdapter)


@pytest.mark.parametrize("bad", [42, "not-a-url", None, ["x"]])
def test_resolve_other_raises_type_error(bad):
    with pytest.raises(TypeError) as ei:
        resolve_agent(bad)
    assert str(ei.value) == (
        f"Loquent can't serve {type(bad).__name__}: pass a function, a URL, or an Adapter"
    )
