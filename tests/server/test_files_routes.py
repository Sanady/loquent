import os
import time

from srv import add_user, login, make_client, new_client, password_settings, sse_events

from loquent.adapters.function import FunctionAdapter
from loquent.files import LocalFileStore, sign_file_url
from loquent.settings import Settings

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20


def upload(c, data=b"hello", name="a.txt", ctype="text/plain", headers=None, field="file"):
    return c.post("/api/files", files={field: (name, data, ctype)}, headers=headers or {})


def rel(url: str) -> str:
    return "/" + url


async def test_upload_and_signed_download(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs) as c:
        r = await upload(c, b"hello", "../../evil name.txt")
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"id", "name", "content_type", "size", "url"}
        assert body["name"] == "evil name.txt"
        assert body["content_type"] == "text/plain"
        assert body["size"] == 5
        assert os.listdir(tmp_path) == [body["id"]]
        g = await c.get(rel(body["url"]))
        assert g.status_code == 200
        assert g.content == b"hello"
        assert g.headers["content-type"].startswith("text/plain")
        assert g.headers["content-disposition"] == "attachment; filename*=UTF-8''evil%20name.txt"
        assert g.headers["x-content-type-options"] == "nosniff"
        assert g.headers["cache-control"] == "private, max-age=300"

        img = (await upload(c, PNG, "p.png", "image/png")).json()
        g = await c.get(rel(img["url"]))
        assert g.headers["content-disposition"].startswith("inline;")
        assert g.headers["content-type"] == "image/png"


async def test_upload_type_and_size_limits(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs, settings=Settings(max_upload_mb=1)) as c:
        r = await upload(c, b"<html>", "x.html", "text/html")
        assert r.status_code == 415
        assert r.json() == {"error": "unsupported_media_type"}
        r = await upload(c, b"x", "x.bin", "application/octet-stream")
        assert r.status_code == 415
        r = await upload(c, b"x" * (1024 * 1024 + 1), "big.txt", "text/plain")
        assert r.status_code == 413
        assert r.json() == {"error": "payload_too_large"}
        assert os.listdir(tmp_path) == []  # no partial file
        r = await upload(c, b"x" * (1024 * 1024), "ok.txt", "text/plain")
        assert r.status_code == 200
        # a type with parameters matches on the bare type
        r = await upload(c, b"x", "ok.txt", "Text/Plain; charset=utf-8")
        assert r.status_code == 200
        assert r.json()["content_type"] == "text/plain"


async def test_over_limit_without_content_length_is_413(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs, settings=Settings(max_upload_mb=1)) as c:
        boundary = "BOUNDARY"
        head = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n'
            "Content-Type: text/plain\r\n\r\n"
        ).encode()
        tail = f"\r\n--{boundary}--\r\n".encode()

        async def body():  # chunked: httpx sends no Content-Length
            yield head
            for _ in range(5):
                yield b"x" * (400 * 1024)
            yield tail

        r = await c.post(
            "/api/files", content=body(),
            headers={"content-type": f"multipart/form-data; boundary={boundary}"},
        )  # fmt: skip
        assert r.status_code == 413
        assert os.listdir(tmp_path) == []


async def test_bad_multipart_requests(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs) as c:
        r = await c.post("/api/files", json={"a": 1})
        assert r.status_code == 415
        r = await upload(c, field="other")
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}
        r = await c.post(
            "/api/files",
            files=[
                ("file", ("a.txt", b"1", "text/plain")),
                ("file", ("b.txt", b"2", "text/plain")),
            ],
        )
        assert r.status_code == 400
        assert os.listdir(tmp_path) == []


async def test_file_get_requires_valid_signature(tmp_path):
    fs = LocalFileStore(tmp_path)
    settings = password_settings()
    async with make_client(file_store=fs, settings=settings) as c:
        await add_user(c, "alice")
        csrf = await login(c, "alice")
        meta = (await upload(c, b"secret", headers={"X-Loquent-CSRF": csrf})).json()
        url = rel(meta["url"])
        path, q = url.split("?")
        exp, sig = [p.split("=")[1] for p in q.split("&")]
        async with new_client(c.app) as anon:  # no session: the signature is the credential
            assert (await anon.get(url)).status_code == 200
            for bad in (
                f"{path}?exp={exp}&sig={'0' * 64}",
                f"{path}?exp={int(exp) + 1}&sig={sig}",
                f"{path}?exp={exp}",
                f"{path}?sig={sig}",
                f"{path}?exp=abc&sig={sig}",
                path,
            ):
                r = await anon.get(bad)
                assert r.status_code == 403, bad
                assert r.json() == {"error": "forbidden"}
            old = sign_file_url(meta["id"], settings.effective_secret(), int(time.time()) - 1000)
            assert (await anon.get(rel(old))).status_code == 403
            # valid signature for a file that doesn't exist
            ghost = sign_file_url("f" * 32, settings.effective_secret(), int(time.time()))
            assert (await anon.get(rel(ghost))).status_code == 404
            # no public unsigned route, and a non-id never reaches the filesystem
            assert (await anon.get("/api/files")).status_code in (404, 405)
            weird = sign_file_url("not-an-id", settings.effective_secret(), int(time.time()))
            assert (await anon.get(rel(weird))).status_code == 404


async def test_upload_needs_auth_csrf_and_rate_limit(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs, settings=password_settings()) as c:
        assert (await upload(c)).status_code == 401
        await add_user(c, "alice")
        csrf = await login(c, "alice")
        r = await upload(c)
        assert r.status_code == 403
        assert r.json() == {"error": "csrf"}
        assert (await upload(c, headers={"X-Loquent-CSRF": csrf})).status_code == 200
        assert os.listdir(tmp_path) != []

    async def deny(request, user):
        return False

    async with make_client(file_store=LocalFileStore(tmp_path / "x"), rate_limiter=deny) as c:
        r = await upload(c)
        assert r.status_code == 429
        assert r.json() == {"error": "rate_limited"}


async def test_no_file_store_means_404_and_attachments_400():
    async with make_client() as c:
        r = await upload(c)
        assert r.status_code == 404
        assert r.json() == {"error": "not_found"}
        r = await c.post(
            "/api/runs",
            json={"input": {"type": "message", "content": "hi", "attachments": ["a" * 32]}},
        )
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}


async def test_attachment_visible_to_function_agent_via_ctx_files(tmp_path):
    seen = {}

    async def agent(messages, ctx):
        seen["files"] = [(f.id, f.name, f.content_type, f.size, await f.read()) for f in ctx.files]
        return "ok"

    fs = LocalFileStore(tmp_path)
    async with make_client(agent, file_store=fs) as c:
        a = (await upload(c, b"AAA", "a.txt")).json()
        b = (await upload(c, PNG, "b.png", "image/png")).json()
        r = await c.post(
            "/api/runs",
            json={"input": {"type": "message", "content": "look",
                            "attachments": [a["id"], b["id"], a["id"]]}},
        )  # fmt: skip
        ev = sse_events(r)
        assert seen["files"] == [
            (a["id"], "a.txt", "text/plain", 3, b"AAA"),
            (b["id"], "b.png", "image/png", len(PNG), PNG),
        ]
        start = next(e for e in ev if e["type"] == "TEXT_MESSAGE_START" and e["role"] == "user")
        assert start["metadata"]["attachments"] == [
            {k: m[k] for k in ("id", "name", "content_type", "size")} for m in (a, b)
        ]


async def test_attachment_errors(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs) as c:
        ids = [(await upload(c)).json()["id"] for _ in range(11)]

        async def post(att):
            return await c.post(
                "/api/runs",
                json={"input": {"type": "message", "content": "x", "attachments": att}},
            )

        assert (await post(ids)).status_code == 400  # more than 10
        r = await post(["f" * 32])
        assert r.status_code == 404
        assert r.json() == {"error": "not_found"}
        r = await post(["../x"])
        assert r.status_code == 404
        assert (await post(ids[:10])).status_code == 200


async def test_attachments_rejected_for_url_adapters(tmp_path):
    adapter = FunctionAdapter(lambda messages: "ok")
    adapter.supports_attachments = False
    fs = LocalFileStore(tmp_path)
    async with make_client(adapter=adapter, file_store=fs) as c:
        fid = (await upload(c)).json()["id"]
        r = await c.post(
            "/api/runs",
            json={"input": {"type": "message", "content": "x", "attachments": [fid]}},
        )
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}
        assert (await c.get("/api/threads")).json() == []  # nothing was created


async def test_other_users_file_is_404_for_attachments(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs, settings=password_settings()) as a:
        await add_user(a, "alice")
        await add_user(a, "bob")
        csrf_a = await login(a, "alice")
        async with new_client(a.app) as b:
            csrf_b = await login(b, "bob")
            f = (await upload(b, b"bob's", headers={"X-Loquent-CSRF": csrf_b})).json()
            r = await a.post(
                "/api/runs",
                json={"input": {"type": "message", "content": "x", "attachments": [f["id"]]}},
                headers={"X-Loquent-CSRF": csrf_a},
            )
            assert r.status_code == 404
            assert r.json() == {"error": "not_found"}
            assert (await a.get("/api/threads")).json() == []


def test_sanitize_name():
    from loquent.server.routes_files import sanitize_name

    assert sanitize_name("../../a/b\\c.txt") == "c.txt"
    assert sanitize_name("e\x00v\x07il\u202e.txt") == "evil.txt"
    assert sanitize_name("") == "file"
    assert sanitize_name("..") == "file"
    assert sanitize_name("dir/") == "file"
    assert len(sanitize_name("a" * 1000)) == 255


def _multipart(body: bytes):
    return {"content-type": "multipart/form-data; boundary=BB", "x-loquent-csrf": ""}, body


_HEAD = (
    b'--BB\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n'
    b"Content-Type: text/plain\r\n\r\n"
)


async def test_malformed_multipart_is_400_and_leaves_nothing(tmp_path):
    fs = LocalFileStore(tmp_path)
    cases = {
        "garbage": b"\x00\x01\x02 not multipart at all",
        "truncated_mid_data": _HEAD + b"some data but no closing boundary",
        "truncated_mid_headers": b'--BB\r\nContent-Disposition: form-data; name="file"; file',
        "truncated_after_headers": _HEAD,
        "empty": b"",
        "header_section_too_big": (
            b'--BB\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n'
            + b"X-Pad: " + b"a" * 9000 + b"\r\nContent-Type: text/plain\r\n\r\nx\r\n--BB--\r\n"
        ),
        "too_many_headers": (
            b'--BB\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n'
            + b"".join(b"X-%d: 1\r\n" % i for i in range(20))
            + b"Content-Type: text/plain\r\n\r\nx\r\n--BB--\r\n"
        ),
    }  # fmt: skip
    async with make_client(file_store=fs) as c:
        for name, body in cases.items():
            headers, content = _multipart(body)
            r = await c.post("/api/files", content=content, headers=headers)
            assert r.status_code == 400, (name, r.status_code, r.text)
            assert r.json() == {"error": "invalid_input"}, name
            assert os.listdir(tmp_path) == [], name
        headers, content = _multipart(_HEAD + b"ok\r\n--BB--\r\n")
        assert (await c.post("/api/files", content=content, headers=headers)).status_code == 200


async def test_auth_none_requires_csrf_header_on_all_posts(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs) as c:
        run = await c.post("/api/runs", json={"input": {"type": "message", "content": "hi"}})
        rid = sse_events(run)[0]["runId"]
        async with new_client(c.app) as bare:  # no header: what a cross-site form would send
            r = await upload(bare)
            assert r.status_code == 403
            assert r.json() == {"error": "csrf"}
            assert os.listdir(tmp_path) == []
            r = await bare.post(f"/api/runs/{rid}/cancel")
            assert r.status_code == 403
            assert r.json() == {"error": "csrf"}
            r = await bare.post("/api/runs", json={"input": {"type": "message", "content": "x"}})
            assert r.status_code == 403
            assert (await bare.get("/api/threads")).status_code == 200  # GET is unaffected
        # present but empty is enough
        assert (await upload(c, headers={"X-Loquent-CSRF": ""})).status_code == 200
        assert (await c.post(f"/api/runs/{rid}/cancel")).status_code == 202


async def test_exp_with_huge_digit_string_is_403(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs) as c:
        meta = (await upload(c)).json()
        sig = meta["url"].split("sig=")[1]
        r = await c.get(f"/api/files/{meta['id']}?exp={'9' * 5000}&sig={sig}")
        assert r.status_code == 403
        assert r.json() == {"error": "forbidden"}


async def test_fresh_url_for_owner_only(tmp_path):
    fs = LocalFileStore(tmp_path)
    async with make_client(file_store=fs, settings=password_settings()) as a:
        await add_user(a, "alice")
        await add_user(a, "bob")
        csrf_a = await login(a, "alice")
        async with new_client(a.app) as b:
            await login(b, "bob")
            f = (await upload(a, b"mine", headers={"X-Loquent-CSRF": csrf_a})).json()
            r = await a.get(f"/api/files/{f['id']}/url")
            assert r.status_code == 200
            async with new_client(a.app) as anon:
                g = await anon.get(rel(r.json()["url"]))
            assert g.status_code == 200 and g.content == b"mine"
            for fid in (f["id"], "f" * 32):
                r = await b.get(f"/api/files/{fid}/url")
                assert r.status_code == 404
                assert r.json() == {"error": "not_found"}
            async with new_client(a.app) as anon:
                assert (await anon.get(f"/api/files/{f['id']}/url")).status_code == 401
        r = await a.get(f"/api/files/{'e' * 32}/url")
        assert r.status_code == 404


async def test_attachment_only_message_is_accepted_and_titled_by_file(tmp_path):
    seen = {}

    async def agent(messages, ctx):
        seen["names"] = [f.name for f in ctx.files]
        return "got it"

    fs = LocalFileStore(tmp_path)
    async with make_client(agent, file_store=fs) as c:
        a = (await upload(c, PNG, "photo.png", "image/png")).json()
        r = await c.post(
            "/api/runs",
            json={"input": {"type": "message", "content": "", "attachments": [a["id"]]}},
        )
        ev = sse_events(r)
        assert ev[-1]["type"] == "RUN_FINISHED"
        assert seen["names"] == ["photo.png"]
        threads = (await c.get("/api/threads")).json()
        assert [t["title"] for t in threads] == ["photo.png"]
        # whitespace-only text with no attachments is still rejected
        r = await c.post("/api/runs", json={"input": {"type": "message", "content": "  "}})
        assert r.status_code == 400
        assert r.json() == {"error": "invalid_input"}
