import json

from ag_ui.core import RunStartedEvent, TextMessageContentEvent

from loquent.protocol import encode_sse, event_to_dict, events_to_messages, new_id, parse_event


def test_text_messages_grouped_by_id_and_role():
    ev = [
        {"type": "TEXT_MESSAGE_START", "messageId": "u1", "role": "user"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "u1", "delta": "Hi"},
        {"type": "TEXT_MESSAGE_END", "messageId": "u1"},
        {"type": "STEP_STARTED", "stepName": "search"},
        {"type": "TEXT_MESSAGE_START", "messageId": "a1"},  # role absent = assistant
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "a1", "delta": "Hel"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "a1", "delta": "lo"},
        {"type": "TEXT_MESSAGE_END", "messageId": "a1"},
    ]
    m = events_to_messages(ev)
    assert [(x.role, x.content) for x in m] == [("user", "Hi"), ("assistant", "Hello")]


def test_tool_call_attaches_to_parent_and_result_becomes_tool_message():
    ev = [
        {"type": "TEXT_MESSAGE_START", "messageId": "a1"},
        {"type": "TEXT_MESSAGE_END", "messageId": "a1"},
        {
            "type": "TOOL_CALL_START",
            "toolCallId": "t1",
            "toolCallName": "loquent_confirm",
            "parentMessageId": "a1",
        },
        {"type": "TOOL_CALL_ARGS", "toolCallId": "t1", "delta": '{"message":'},
        {"type": "TOOL_CALL_ARGS", "toolCallId": "t1", "delta": '"Ok?"}'},
        {"type": "TOOL_CALL_END", "toolCallId": "t1"},
        {
            "type": "TOOL_CALL_RESULT",
            "messageId": "r1",
            "toolCallId": "t1",
            "content": '{"confirmed":true}',
        },
    ]
    a, t = events_to_messages(ev)
    assert a.id == "a1"
    assert a.tool_calls[0].id == "t1"
    assert a.tool_calls[0].function.name == "loquent_confirm"
    assert a.tool_calls[0].function.arguments == '{"message":"Ok?"}'
    assert t.role == "tool" and t.tool_call_id == "t1" and t.id == "r1"
    assert t.content == '{"confirmed":true}'


def test_tool_call_without_parent_creates_assistant_message():
    ev = [
        {"type": "TOOL_CALL_START", "toolCallId": "t1", "toolCallName": "f"},
        {"type": "TOOL_CALL_ARGS", "toolCallId": "t1", "delta": "{}"},
        {"type": "TOOL_CALL_END", "toolCallId": "t1"},
    ]
    (a,) = events_to_messages(ev)
    assert a.role == "assistant"
    assert not a.content
    assert [c.id for c in a.tool_calls] == ["t1"]


def test_unterminated_text_kept_unterminated_tool_call_dropped():
    ev = [
        {"type": "TEXT_MESSAGE_START", "messageId": "a1"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "a1", "delta": "partial"},
        {"type": "TOOL_CALL_START", "toolCallId": "t1", "toolCallName": "f", "parentMessageId": "a1"},
        {"type": "TOOL_CALL_ARGS", "toolCallId": "t1", "delta": "{"},
    ]
    (a,) = events_to_messages(ev)
    assert a.content == "partial"
    assert not a.tool_calls


def test_encode_sse_has_id_and_camelcase():
    s = encode_sse(7, TextMessageContentEvent(message_id="m", delta="x"))
    assert s.startswith("id: 7\ndata: ") and '"messageId":"m"' in s and s.endswith("\n\n")


def test_encode_sse_accepts_dict():
    s = encode_sse(1, {"type": "STEP_STARTED", "stepName": "s"})
    assert json.loads(s.split("data: ", 1)[1]) == {"type": "STEP_STARTED", "stepName": "s"}


def test_parse_event_and_event_to_dict_roundtrip():
    d = {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m", "delta": "x"}
    e = parse_event(d)
    assert isinstance(e, TextMessageContentEvent)
    assert event_to_dict(e) == d
    assert event_to_dict(RunStartedEvent(thread_id="t", run_id="r"))["threadId"] == "t"


def test_new_id_is_uuid_hex():
    a, b = new_id(), new_id()
    assert a != b and len(a) == 32 and int(a, 16) >= 0
