"""Object storage for documents: local files and Supabase Storage (REST)."""

import httpx
import pytest

from app import storage
from app.storage import LocalStore, StorageError, SupabaseStore

KEY = "projects/p1/docs/d1_Quote 2026.pdf"


def test_local_store_roundtrip_and_key_safety(tmp_path):
    st = LocalStore(tmp_path)
    st.put(KEY, b"abc", "application/pdf")
    assert (tmp_path / "projects" / "p1" / "docs" / "d1_Quote 2026.pdf").read_bytes() == b"abc"
    assert st.get(KEY) == b"abc"
    st.delete(KEY)
    st.delete(KEY)                                   # idempotent
    with pytest.raises(StorageError):
        st.get(KEY)
    for bad in ("../x", "projects/../etc/passwd", "/projects/p1/docs/x", "other/p1/x",
                "projects//x", "projects/p1\\docs\\x", ""):
        with pytest.raises(StorageError):
            st.put(bad, b"", "application/octet-stream")


def test_supabase_store_talks_to_the_storage_rest_api():
    objects: dict[str, bytes] = {}
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["authorization"] == "Bearer service-role-key"
        assert request.headers["apikey"] == "service-role-key"
        path = request.url.path
        if request.method == "POST":
            objects[path] = request.content
            return httpx.Response(200, json={"Key": path})
        if request.method == "GET":
            if path in objects:
                return httpx.Response(200, content=objects[path])
            return httpx.Response(404, json={"statusCode": "404", "error": "not_found"})
        if request.method == "DELETE":
            objects.pop(path, None)
            return httpx.Response(200, json={"message": "Successfully deleted"})
        return httpx.Response(405)

    st = SupabaseStore("https://unit.supabase.co/", "service-role-key", "documents",
                       transport=httpx.MockTransport(handler))
    st.put(KEY, b"%PDF", "application/pdf")
    assert str(calls[0].url) == (
        "https://unit.supabase.co/storage/v1/object/documents/projects/p1/docs/d1_Quote%202026.pdf"
    )
    assert calls[0].headers["x-upsert"] == "true"
    assert calls[0].headers["content-type"] == "application/pdf"
    assert st.get(KEY) == b"%PDF"
    st.delete(KEY)
    assert [c.method for c in calls] == ["POST", "GET", "DELETE"]
    with pytest.raises(StorageError):
        st.get(KEY)


def test_supabase_store_surfaces_failures_as_storage_errors():
    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    st = SupabaseStore("https://unit.supabase.co", "k", "documents",
                       transport=httpx.MockTransport(failing))
    with pytest.raises(StorageError, match="500"):
        st.put(KEY, b"x", "application/pdf")
    with pytest.raises(StorageError):
        st.delete(KEY)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    st = SupabaseStore("https://unit.supabase.co", "k", "documents",
                       transport=httpx.MockTransport(down))
    with pytest.raises(StorageError, match="unreachable"):
        st.get(KEY)


def test_get_store_follows_the_settings(monkeypatch):
    from pydantic import SecretStr

    from app.core.config import get_settings

    s = get_settings()
    storage.reset()
    try:
        assert storage.get_store().backend == "local"
        monkeypatch.setattr(s, "supabase_url", "https://unit.supabase.co")
        monkeypatch.setattr(s, "supabase_service_role_key", SecretStr("service-role-key"))
        store = storage.get_store()
        assert store.backend == "supabase" and store.bucket == "documents"
        assert storage.get_store() is store                    # cached while unchanged
    finally:
        storage.reset()
