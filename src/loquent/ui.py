"""Interactive widgets the agent can ask the end user, plus answer validation."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ag_ui.core import Tool

CONFIRM_TOOL = "loquent_confirm"
SELECT_TOOL = "loquent_select"
FORM_TOOL = "loquent_form"

MAX_OPTIONS = 20
_FIELD_TYPES = {"string", "number", "integer", "boolean"}


class InvalidAnswer(ValueError):
    """A widget answer does not match the widget it answers."""


@dataclass
class Confirm:
    message: str
    key: str | None = None
    confirm_label: str = "Approve"
    reject_label: str = "Reject"

    tool_name = CONFIRM_TOOL

    def args(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "message": self.message,
            "confirmLabel": self.confirm_label,
            "rejectLabel": self.reject_label,
        }
        if self.key is not None:
            out["key"] = self.key
        return out


@dataclass
class Select:
    message: str
    options: list[str | tuple[str, str]]
    multiple: bool = False
    key: str | None = None

    tool_name = SELECT_TOOL

    def __post_init__(self) -> None:
        if not 1 <= len(self.options) <= MAX_OPTIONS:
            raise ValueError(f"Select needs between 1 and {MAX_OPTIONS} options")

    def args(self) -> dict[str, Any]:
        opts = [
            {"value": o, "label": o} if isinstance(o, str) else {"value": o[0], "label": o[1]}
            for o in self.options
        ]
        out: dict[str, Any] = {
            "message": self.message,
            "options": opts,
            "multiple": self.multiple,
        }
        if self.key is not None:
            out["key"] = self.key
        return out


@dataclass
class Form:
    message: str
    schema: dict[str, Any]
    key: str | None = None

    tool_name = FORM_TOOL

    def args(self) -> dict[str, Any]:
        out: dict[str, Any] = {"message": self.message, "schema": self.schema}
        if self.key is not None:
            out["key"] = self.key
        return out


Widget = Confirm | Select | Form


@dataclass
class WidgetRequest:
    widget: Widget

    @property
    def tool_name(self) -> str:
        return self.widget.tool_name

    def args_json(self) -> str:
        return json.dumps(self.widget.args(), separators=(",", ":"))


def ask(widget: Widget) -> WidgetRequest:
    return WidgetRequest(widget)


_KEY = {"type": "string"}
WIDGET_TOOLS: list[Tool] = [
    Tool(
        name=CONFIRM_TOOL,
        description="Ask the user to approve or reject something.",
        parameters={
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "confirmLabel": {"type": "string"},
                "rejectLabel": {"type": "string"},
                "key": _KEY,
            },
            "required": ["message"],
        },
    ),
    Tool(
        name=SELECT_TOOL,
        description="Ask the user to choose from a list of options.",
        parameters={
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "options": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_OPTIONS,
                    "items": {
                        "type": "object",
                        "properties": {"value": {"type": "string"}, "label": {"type": "string"}},
                        "required": ["value", "label"],
                    },
                },
                "multiple": {"type": "boolean"},
                "key": _KEY,
            },
            "required": ["message", "options"],
        },
    ),
    Tool(
        name=FORM_TOOL,
        description="Ask the user to fill in a small form described by a flat JSON Schema.",
        parameters={
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "schema": {
                    "type": "object",
                    "properties": {
                        "type": {"const": "object"},
                        "properties": {"type": "object"},
                        "required": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["type", "properties"],
                },
                "key": _KEY,
            },
            "required": ["message", "schema"],
        },
    ),
]

_NAMES = {t.name for t in WIDGET_TOOLS}


def is_widget_tool(name: str) -> bool:
    return name in _NAMES


def _option_values(options: Any) -> set[str]:
    values: set[str] = set()
    for o in options or []:
        if isinstance(o, str):
            values.add(o)
        elif isinstance(o, dict) and isinstance(o.get("value"), str):
            values.add(o["value"])
        elif isinstance(o, (list, tuple)) and o and isinstance(o[0], str):
            values.add(o[0])
    return values


def _check_field(name: str, spec: dict, value: Any) -> None:
    enum = spec.get("enum")
    if enum is not None:
        if not isinstance(value, str) or value not in enum:
            raise InvalidAnswer(f"field {name!r} must be one of {enum}")
        return
    t = spec.get("type")
    if t == "string":
        ok = isinstance(value, str)
    elif t == "boolean":
        ok = isinstance(value, bool)
    elif t == "integer":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif t == "number":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    else:
        raise InvalidAnswer(f"field {name!r} has unsupported type {t!r}")
    if not ok:
        raise InvalidAnswer(f"field {name!r} must be of type {t}")


def validate_answer(tool_name: str, args: dict, answer: Any) -> None:
    """Raise InvalidAnswer unless `answer` is a valid result for the widget call."""
    if not isinstance(answer, dict):
        raise InvalidAnswer("answer must be an object")
    if tool_name == CONFIRM_TOOL:
        if not isinstance(answer.get("confirmed"), bool):
            raise InvalidAnswer("confirm answer needs boolean 'confirmed'")
    elif tool_name == SELECT_TOOL:
        allowed = _option_values(args.get("options"))
        if args.get("multiple"):
            values = answer.get("values")
            if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
                raise InvalidAnswer("select answer needs a list 'values'")
            bad = [v for v in values if v not in allowed]
            if bad:
                raise InvalidAnswer(f"unknown option(s): {bad}")
        else:
            value = answer.get("value")
            if not isinstance(value, str):
                raise InvalidAnswer("select answer needs string 'value'")
            if value not in allowed:
                raise InvalidAnswer(f"unknown option: {value!r}")
    elif tool_name == FORM_TOOL:
        values = answer.get("values")
        if not isinstance(values, dict):
            raise InvalidAnswer("form answer needs object 'values'")
        schema = args.get("schema") or {}
        props = schema.get("properties") or {}
        for name in schema.get("required") or []:
            if name not in values or values[name] is None:
                raise InvalidAnswer(f"missing required field {name!r}")
        for name, value in values.items():
            if name not in props:
                raise InvalidAnswer(f"unknown field {name!r}")
            _check_field(name, props[name], value)
    else:
        raise InvalidAnswer(f"not a widget tool: {tool_name!r}")
