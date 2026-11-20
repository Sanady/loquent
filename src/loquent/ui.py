"""Interactive widgets the agent can ask the end user, plus answer validation."""

from __future__ import annotations

import json
import math
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
    options: list[str | tuple[str, str] | list[str]]
    multiple: bool = False
    key: str | None = None

    tool_name = SELECT_TOOL

    def __post_init__(self) -> None:
        if not 1 <= len(self.options) <= MAX_OPTIONS:
            raise ValueError(f"Select needs between 1 and {MAX_OPTIONS} options")
        values = []
        for o in self.options:
            if isinstance(o, str):
                values.append(o)
            elif (
                isinstance(o, (tuple, list))
                and len(o) == 2
                and isinstance(o[0], str)
                and isinstance(o[1], str)
            ):
                values.append(o[0])
            else:
                raise ValueError(f"Select option must be a string or (value, label): {o!r}")
        if len(set(values)) != len(values):
            raise ValueError("Select option values must be unique")

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

    def __post_init__(self) -> None:
        _check_schema(self.schema)

    def args(self) -> dict[str, Any]:
        out: dict[str, Any] = {"message": self.message, "schema": self.schema}
        if self.key is not None:
            out["key"] = self.key
        return out


def _check_schema(schema: Any) -> None:
    """Raise ValueError unless the UI can display ``schema`` (a flat JSON Schema object)."""
    if not isinstance(schema, dict):
        raise ValueError("Form schema must be a dict")  # noqa: TRY004 - documented as ValueError
    props = schema.get("properties")
    if not isinstance(props, dict) or not props:
        raise ValueError("Form schema needs a non-empty 'properties' object")
    for name, spec in props.items():
        if not isinstance(spec, dict):
            raise ValueError(f"Form field {name!r} must be a dict")  # noqa: TRY004
        if "enum" in spec:
            enum = spec["enum"]
            if not isinstance(enum, list) or not enum or not all(isinstance(e, str) for e in enum):
                raise ValueError(f"Form field {name!r}: 'enum' must be a non-empty list of strings")
        elif spec.get("type") not in _FIELD_TYPES:
            raise ValueError(
                f"Form field {name!r}: type must be one of {sorted(_FIELD_TYPES)} (or an enum)"
            )
    required = schema.get("required", [])
    if not isinstance(required, list) or not all(isinstance(r, str) for r in required):
        raise ValueError("Form schema 'required' must be a list of field names")
    missing = [r for r in required if r not in props]
    if missing:
        raise ValueError(f"Form schema requires fields not in 'properties': {missing}")


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


def _option_values(options: Any) -> list[str]:
    if not isinstance(options, (list, tuple)):
        raise InvalidAnswer("widget options are malformed")
    values: list[str] = []
    for o in options:
        if isinstance(o, str):
            values.append(o)
        elif isinstance(o, dict) and isinstance(o.get("value"), str):
            values.append(o["value"])
        elif isinstance(o, (list, tuple)) and len(o) == 2 and all(isinstance(x, str) for x in o):
            values.append(o[0])
        else:
            raise InvalidAnswer("widget options are malformed")
    return values


def _check_field(name: str, spec: Any, value: Any) -> None:
    if not isinstance(spec, dict):
        raise InvalidAnswer(f"field {name!r} has a malformed schema")
    enum = spec.get("enum")
    if enum is not None:
        if not isinstance(enum, list):
            raise InvalidAnswer(f"field {name!r} has a malformed enum")
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
        ok = (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and (isinstance(value, int) or math.isfinite(value))
        )
    else:
        raise InvalidAnswer(f"field {name!r} has unsupported type {t!r}")
    if not ok:
        raise InvalidAnswer(f"field {name!r} must be of type {t}")


def validate_answer(tool_name: str, args: dict, answer: Any) -> None:
    """Raise InvalidAnswer (and only InvalidAnswer) unless `answer` is valid for the call."""
    if not isinstance(answer, dict):
        raise InvalidAnswer("answer must be an object")
    if not isinstance(args, dict):
        raise InvalidAnswer("widget arguments are malformed")
    if tool_name == CONFIRM_TOOL:
        if not isinstance(answer.get("confirmed"), bool):
            raise InvalidAnswer("confirm answer needs boolean 'confirmed'")
    elif tool_name == SELECT_TOOL:
        allowed = _option_values(args.get("options"))
        if args.get("multiple") is True:  # exactly as the UI decides it
            values = answer.get("values")
            if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
                raise InvalidAnswer("select answer needs a list 'values'")
            if len(values) != len(set(values)):
                raise InvalidAnswer("duplicate selections")
            if len(values) > len(set(allowed)):
                raise InvalidAnswer("too many selections")
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
        schema = args.get("schema")
        if not isinstance(schema, dict):
            raise InvalidAnswer("form schema is malformed")
        props = schema.get("properties") or {}
        required = schema.get("required") or []
        if not isinstance(props, dict) or not isinstance(required, list):
            raise InvalidAnswer("form schema is malformed")
        for name in required:
            if not isinstance(name, str):
                raise InvalidAnswer("form schema is malformed")
            if name not in values or values[name] is None:
                raise InvalidAnswer(f"missing required field {name!r}")
        for name, value in values.items():
            if name not in props:
                raise InvalidAnswer(f"unknown field {name!r}")
            _check_field(name, props[name], value)
    else:
        raise InvalidAnswer(f"not a widget tool: {tool_name!r}")
