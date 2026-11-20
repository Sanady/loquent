import os

import pytest

from loquent.files import FileTooLarge, LocalFileStore, sign_file_url, verify_file_sig

SECRET = "s3cret"
FID = "a" * 32


def parse(url: str) -> tuple[str, int, str]:
    path, q = url.split("?")
    params = dict(p.split("=") for p in q.split("&"))
    return path, int(params["exp"]), params["sig"]


def test_sign_verify_roundtrip_expiry_tamper():
    url = sign_file_url(FID, SECRET, now=1000)
    path, exp, sig = parse(url)
    assert path == f"api/files/{FID}"
    assert exp == 1300
    assert verify_file_sig(FID, exp, sig, SECRET, now=1000)
    assert verify_file_sig(FID, exp, sig, SECRET, now=1300)
    assert not verify_file_sig(FID, exp, sig, SECRET, now=1301)  # expired
    assert not verify_file_sig(FID, exp, sig, "other", now=1000)  # wrong secret
    assert not verify_file_sig("b" * 32, exp, sig, SECRET, now=1000)  # other file
    assert not verify_file_sig(FID, exp + 1, sig, SECRET, now=1000)  # exp tampered
    assert not verify_file_sig(FID, exp, sig[:-1] + ("0" if sig[-1] != "0" else "1"), SECRET, 1000)
    assert not verify_file_sig(FID, exp, "", SECRET, now=1000)
    assert not verify_file_sig(FID, exp, "é" * 64, SECRET, now=1000)  # non-ascii, no crash


async def chunks(*parts: bytes):
    for p in parts:
        yield p


async def test_save_read_delete(tmp_path):
    fs = LocalFileStore(tmp_path / "files")
    assert await fs.save(FID, chunks(b"abc", b"def"), 100) == 6
    assert await fs.read(FID) == b"abcdef"
    assert os.listdir(tmp_path / "files") == [FID]  # named by id only
    await fs.delete(FID)
    with pytest.raises(FileNotFoundError):
        await fs.read(FID)
    await fs.delete(FID)  # idempotent


async def test_save_over_limit_raises_and_leaves_nothing(tmp_path):
    fs = LocalFileStore(tmp_path)
    with pytest.raises(FileTooLarge):
        await fs.save(FID, chunks(b"x" * 6, b"x" * 6), 10)
    assert os.listdir(tmp_path) == []
    with pytest.raises(FileNotFoundError):
        await fs.read(FID)
    assert await fs.save(FID, chunks(b"x" * 10), 10) == 10  # exactly the limit is fine


async def test_save_failure_midstream_leaves_nothing(tmp_path):
    fs = LocalFileStore(tmp_path)

    async def boom():
        yield b"abc"
        raise RuntimeError("client went away")

    with pytest.raises(RuntimeError):
        await fs.save(FID, boom(), 100)
    assert os.listdir(tmp_path) == []


@pytest.mark.parametrize(
    "bad", ["../etc/passwd", "a" * 31, "A" * 32, "g" * 32, "", "a" * 32 + "/x"]
)
async def test_bad_ids_never_touch_the_filesystem(tmp_path, bad):
    fs = LocalFileStore(tmp_path)
    with pytest.raises(ValueError):
        await fs.save(bad, chunks(b"x"), 10)
    with pytest.raises((ValueError, FileNotFoundError)):
        await fs.read(bad)
    with pytest.raises(ValueError):
        await fs.delete(bad)
    assert os.listdir(tmp_path) == []
