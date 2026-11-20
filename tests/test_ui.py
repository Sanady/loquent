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


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize("ftype", ["number", "integer"])
def test_form_rejects_non_finite(ftype, bad):
    args = Form("f", {"type": "object", "properties": {"n": {"type": ftype}}}).args()
    with pytest.raises(InvalidAnswer):
        validate_answer("loquent_form", args, {"values": {"n": bad}})


def test_multi_select_duplicates_rejected_empty_accepted():
    args = Select("p", ["a", "b"], multiple=True).args()
    validate_answer("loquent_select", args, {"values": []})
    with pytest.raises(InvalidAnswer):
        validate_answer("loquent_select", args, {"values": ["a", "a"]})
    with pytest.raises(InvalidAnswer):
        validate_answer("loquent_select", args, {"values": ["a", "b", "a"]})


@pytest.mark.parametrize(
    "tool,args,answer",
    [
        ("loquent_select", None, {"value": "a"}),
        ("loquent_select", {"options": 5}, {"value": "a"}),
        ("loquent_select", {"options": [1, None]}, {"value": "a"}),
        ("loquent_select", {"options": ["a"], "multiple": True}, {"values": [["a"]]}),
        ("loquent_form", [], {"values": {}}),
        ("loquent_form", {"schema": 3}, {"values": {}}),
        ("loquent_form", {"schema": {"properties": [1]}}, {"values": {}}),
        ("loquent_form", {"schema": {"properties": {"a": 1}}}, {"values": {"a": "x"}}),
        ("loquent_form", {"schema": {"properties": {}, "required": "a"}}, {"values": {}}),
        ("loquent_form", {"schema": {"properties": {}, "required": [["a"]]}}, {"values": {}}),
        ("loquent_form", {"schema": {"properties": {"a": {"enum": 3}}}}, {"values": {"a": "x"}}),
        ("loquent_confirm", "junk", {"confirmed": True}),
    ],
)
def test_malformed_args_raise_only_invalid_answer(tool, args, answer):
    with pytest.raises(InvalidAnswer):
        validate_answer(tool, args, answer)


@pytest.mark.parametrize("ftype", ["number", "integer"])
def test_form_huge_int_accepted_without_overflow(ftype):
    args = Form("f", {"type": "object", "properties": {"n": {"type": ftype}}}).args()
    validate_answer("loquent_form", args, {"values": {"n": 10**400}})


def test_select_multiple_must_be_exactly_true_to_expect_values():
    args = {"message": "m", "options": ["a", "b"], "multiple": "yes"}  # truthy, not True
    validate_answer("loquent_select", args, {"value": "a"})  # what the client sends
    with pytest.raises(InvalidAnswer):
        validate_answer("loquent_select", args, {"values": ["a"]})


def test_select_rejects_duplicate_option_values():
    with pytest.raises(ValueError, match="unique"):
        Select("x", ["a", ("a", "Also a")])
    with pytest.raises(ValueError):
        Select("x", ["a", ("b",)])  # type: ignore[list-item]
    Select("x", ["a", ("b", "Bee")])


@pytest.mark.parametrize(
    "schema",
    [
        {"type": "object", "properties": {}},
        {"type": "object", "properties": {"a": {"type": "array"}}},
        {"type": "object", "properties": {"a": {}}},
        {"type": "object", "properties": {"a": "string"}},
        {"type": "object", "properties": {"a": {"enum": [1, 2]}}},
        {"type": "object", "properties": {"a": {"enum": []}}},
        {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["b"]},
        {"type": "object", "properties": {"a": {"type": "string"}}, "required": "a"},
        {"properties": "nope"},
    ],
)
def test_form_rejects_unsupported_schema_at_construction(schema):
    with pytest.raises(ValueError):
        Form("f", schema)


def test_form_accepts_supported_schema():
    Form(
        "f",
        {
            "type": "object",
            "properties": {
                "s": {"type": "string", "title": "S"},
                "n": {"type": "number"},
                "i": {"type": "integer"},
                "b": {"type": "boolean"},
                "e": {"enum": ["x", "y"]},
            },
            "required": ["s", "e"],
        },
    )


def test_select_accepts_list_pairs():
    assert Select("Pick", [["pro", "Pro plan"], "basic"]).args()["options"] == [
        {"value": "pro", "label": "Pro plan"},
        {"value": "basic", "label": "basic"},
    ]


def test_validate_answer_accepts_value_from_list_pair():
    validate_answer(
        "loquent_select", {"message": "m", "options": [["pro", "Pro"]]}, {"value": "pro"}
    )
