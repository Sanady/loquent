"""The ``loquent`` command line."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import importlib
import importlib.util
import os
import sys
from pathlib import Path
from typing import Any

from loquent.app import serve
from loquent.auth import InsecureConfigError, hash_password
from loquent.settings import Settings
from loquent.store.factory import open_store


class CliError(Exception):
    """A usage or configuration error: printed to stderr, exit code 2."""


def _load_target(target: str) -> Any:
    if target.startswith(("http://", "https://")):
        return target
    path_part, sep, attr = target.rpartition(":")
    if not sep or not path_part or not attr:
        raise CliError(
            f"invalid target {target!r}: expected URL, path/to/file.py:attr or pkg.module:attr"
        )
    if path_part.endswith(".py") or "/" in path_part or os.sep in path_part:
        file = Path(path_part)
        if not file.is_file():
            raise CliError(f"target file not found: {path_part}")
        spec = importlib.util.spec_from_file_location(file.stem, file)
        if spec is None or spec.loader is None:
            raise CliError(f"cannot load {path_part}")
        module = importlib.util.module_from_spec(spec)
        sys.path.insert(0, str(file.resolve().parent))  # sibling imports, like `python file.py`
        try:
            spec.loader.exec_module(module)
        except Exception as e:
            raise CliError(f"error importing {path_part}: {e!r}") from e
    else:
        if "" not in sys.path and os.getcwd() not in sys.path:
            sys.path.insert(0, os.getcwd())
        try:
            module = importlib.import_module(path_part)
        except ImportError as e:
            raise CliError(f"cannot import module {path_part!r}: {e}") from e
    try:
        return getattr(module, attr)
    except AttributeError:
        raise CliError(f"{path_part!r} has no attribute {attr!r}") from None


def _cmd_serve(args: argparse.Namespace) -> int:
    agent = _load_target(args.target)
    overrides: dict[str, Any] = {}
    if args.api_key_env:
        key = os.environ.get(args.api_key_env)
        if not key:
            raise CliError(f"environment variable {args.api_key_env} is not set")
        overrides["api_key"] = key
    for flag, field in (
        ("model", "model"),
        ("host", "host"),
        ("port", "port"),
        ("store", "store_url"),
        ("auth", "auth"),
        ("root_path", "root_path"),
    ):
        value = getattr(args, flag)
        if value is not None:
            overrides[field] = value
    if args.insecure_no_auth:
        overrides["insecure_no_auth"] = True
    if args.forwarded_allow_ips is not None:
        overrides["forwarded_allow_ips"] = [
            p.strip() for p in args.forwarded_allow_ips.split(",") if p.strip()
        ]
    try:
        serve(agent, **overrides)
    except InsecureConfigError as e:
        hint = " Pass --insecure-no-auth to override." if "insecure_no_auth" in str(e) else ""
        raise CliError(f"{e}{hint}") from e
    return 0


async def _add_user(url: str, username: str, password_hash: str) -> None:
    store = open_store(url)
    await store.init()
    try:
        await store.create_user(username, password_hash)
    finally:
        await store.close()


def _cmd_user_add(args: argparse.Namespace) -> int:
    url = args.store or Settings().store_url
    pw = getpass.getpass("Password: ")
    if not pw:
        raise CliError("password must not be empty")
    if getpass.getpass("Repeat password: ") != pw:
        raise CliError("passwords do not match")
    try:
        asyncio.run(_add_user(url, args.username, hash_password(pw)))
    except ValueError as e:
        raise CliError(str(e)) from e
    print(f"created user {args.username}")
    return 0


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="loquent", description="Serve a chat UI over AG-UI.")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("serve", help="serve an agent")
    s.add_argument("target", help="URL, path/to/file.py:attr, or pkg.module:attr")
    s.add_argument("--model")
    s.add_argument(
        "--api-key-env", metavar="NAME", help="name of the environment variable holding the API key"
    )
    s.add_argument("--host")
    s.add_argument("--port", type=int)
    s.add_argument("--store", metavar="URL")
    s.add_argument("--auth", choices=["none", "password"])
    s.add_argument("--insecure-no-auth", action="store_true")
    s.add_argument("--root-path")
    s.add_argument("--forwarded-allow-ips", metavar="IPS", help="comma-separated trusted proxies")
    s.set_defaults(func=_cmd_serve)

    u = sub.add_parser("user", help="manage users")
    usub = u.add_subparsers(dest="user_command", required=True)
    add = usub.add_parser("add", help="create a user (password is prompted)")
    add.add_argument("username")
    add.add_argument("--store", metavar="URL")
    add.set_defaults(func=_cmd_user_add)
    return p


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
    except SystemExit as e:  # argparse exits on --help and usage errors
        return e.code if isinstance(e.code, int) else 2
    try:
        return args.func(args)
    except CliError as e:
        print(f"loquent: error: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
