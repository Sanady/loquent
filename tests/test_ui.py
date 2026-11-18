import pytest
from ag_ui.core import AssistantMessage, FunctionCall, ToolCall, ToolMessage, UserMessage

from loquent.context import RunContext, WidgetAnswer
from loquent.ui import (
    WIDGET_TOOLS,
    Form,
    InvalidAnswer,
    Select,
    ask,
    is_widget_tool,
    validate_answer,
)


def test_widget_tools_have_expected_names():
    assert {t.name for t in WIDGET_TOOLS} == {"loquent_confirm", "loquent_select", "loquent_form"}
    assert is_widget_tool("loquent_form") and not is_widget_tool("other")


def test_validate_answer_confirm():
    validate_answer("loquent_confirm", {}, {"confirmed": False})
    with pytest.raises(InvalidAnswer):
        validate_answer("loquent_confirm", {}, {"confirmed": "yes"})


def test_validate_answer_select_rejects_unknown_value():
    args = ask(Select("Pick", ["a", ("b", "Bee")])).widget.args()
    validate_answer("loquent_select", args, {"value": "b"})
    with pytest.raises(InvalidAnswer):
        validate_answer("loquent_select", args, {"value": "zzz"})
    multi = Select("Pick", ["a", "b"], multiple=True).args()
    validate_answer("loquent_select", multi, {"values": ["a", "b"]})
    with pytest.raises(InvalidAnswer):
        validate_answer("loquent_select", multi, {"values": ["a", "x"]})


def test_select_option_count_limits():
    with pytest.raises(ValueError):
        Select("x", [])
    with pytest.raises(ValueError):
        Select("x", [str(i) for i in range(21)])


def test_validate_answer_form_checks_required_and_types():
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer"},
            "ok": {"type": "boolean"},
            "size": {"type": "string", "enum": ["s", "m"]},
        },
        "required": ["name"],
    }
    args = Form("Fill", schema).args()
    validate_answer("loquent_form", args, {"values": {"name": "x", "age": 3, "size": "m"}})
    for bad in (
        {"values": {"age": 3}},
        {"values": {"name": "x", "age": "3"}},
        {"values": {"name": "x", "age": True}},
        {"values": {"name": "x", "size": "xl"}},
        {"values": {"name": "x", "extra": 1}},
        {"values": {"name": "x", "ok": "true"}},
        {"name": "x"},
    ):
        with pytest.raises(InvalidAnswer):
            validate_answer("loquent_form", args, bad)


def _ctx(messages):
    return RunContext(thread_id="t", run_id="r", messages=messages)


def test_ctx_answer_reads_last_widget_result():
    call = ToolCall(
        id="c1",
        function=FunctionCall(
            name="loquent_confirm", arguments='{"message":"Refund?","key":"refund"}'
        ),
    )
    msgs = [
        UserMessage(id="u", content="refund me"),
        AssistantMessage(id="a", content=None, tool_calls=[call]),
        ToolMessage(id="t1", content='{"confirmed": true}', tool_call_id="c1"),
    ]
    assert _ctx(msgs).answer == WidgetAnswer(
        key="refund", tool="loquent_confirm", value={"confirmed": True}
    )


def test_ctx_answer_none_after_plain_user_message():
    assert _ctx([UserMessage(id="u", content="hi")]).answer is None
    assert _ctx([]).answer is None


def test_ctx_answer_none_for_non_widget_tool():
    call = ToolCall(id="c1", function=FunctionCall(name="search", arguments="{}"))
    msgs = [
        AssistantMessage(id="a", content=None, tool_calls=[call]),
        ToolMessage(id="t1", content="{}", tool_call_id="c1"),
    ]
    assert _ctx(msgs).answer is None
