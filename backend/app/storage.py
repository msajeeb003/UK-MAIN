"""
Object storage for retained documents (BRD S4 / 2.9).

Two backends behind one tiny interface:

- **Supabase Storage** — production. Objects go to a private bucket through
  the Storage REST API with the service-role key (server-side only; the
  browser never sees it). Configure `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET`.
- **Local files** — development and the test suite: objects are written
  under `DATA_DIR/<key>`, which keeps the pre-existing layout
  (`projects/<id>/docs/<file>`) so backups and erasure behave as before.

Keys are always `projects/<project_id>/docs/<document_id>_<safe name>`;
the store never interprets them beyond path safety.
"""

import logging
import threading
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    """The object store could not complete the operation."""


class ObjectStore(Protocol):
    backend: str

    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


def _check_key(key: str) -> str:
    parts = key.split("/")
    if (not key or key.startswith("/") or ".." in parts or "" in parts
            or parts[0] != "projects" or any("\\" in p for p in parts)):
        raise StorageError(f"Refusing unsafe object key: {key!r}")
    return key


class LocalStore:
    backend = "local"

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / _check_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as exc:
            raise StorageError(f"Could not write {key}: {exc}") from exc

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except OSError as exc:
            raise StorageError(f"Object not found: {key}") from exc

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink(missing_ok=True)
        except OSError as exc:
            raise StorageError(f"Could not delete {key}: {exc}") from exc


class SupabaseStore:
    """Supabase Storage via its REST API (no SDK dependency).

    Endpoints used (all under `<SUPABASE_URL>/storage/v1`):
      POST   /object/<bucket>/<key>   upload (x-upsert so a retry overwrites)
      GET    /object/<bucket>/<key>   download (service role reads private buckets)
      DELETE /object/<bucket>/<key>   remove
    """

    backend = "supabase"

    def __init__(self, url: str, service_role_key: str, bucket: str,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.bucket = bucket
        self._client = httpx.Client(
            base_url=f"{url.rstrip('/')}/storage/v1",
            headers={"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key},
            timeout=httpx.Timeout(60.0, connect=10.0),
            transport=transport,
        )

    def _object_path(self, key: str) -> str:
        return f"/object/{quote(self.bucket, safe='')}/{quote(_check_key(key), safe='/')}"

    def _request(self, method: str, key: str, **kwargs) -> httpx.Response:
        try:
            return self._client.request(method, self._object_path(key), **kwargs)
        except httpx.HTTPError as exc:
            raise StorageError(f"Supabase Storage unreachable ({method} {key}): {exc}") from exc

    def put(self, key: str, data: bytes, content_type: str) -> None:
        res = self._request("POST", key, content=data,
                            headers={"Content-Type": content_type, "x-upsert": "true"})
        if res.status_code >= 300:
            raise StorageError(f"Supabase Storage upload failed ({res.status_code}): {res.text[:200]}")

    def get(self, key: str) -> bytes:
        res = self._request("GET", key)
        if res.status_code == 404:
            raise StorageError(f"Object not found: {key}")
        if res.status_code >= 300:
            raise StorageError(f"Supabase Storage download failed ({res.status_code}): {res.text[:200]}")
        return res.content

    def delete(self, key: str) -> None:
        res = self._request("DELETE", key)
        if res.status_code >= 300 and res.status_code != 404:
            raise StorageError(f"Supabase Storage delete failed ({res.status_code}): {res.text[:200]}")


_lock = threading.Lock()
_store: ObjectStore | None = None
_store_config: tuple = ()


def get_store() -> ObjectStore:
    """The configured object store (rebuilt if the settings change)."""
    global _store, _store_config
    s = get_settings()
    config = (s.supabase_url, s.supabase_service_role_key.get_secret_value(),
              s.supabase_storage_bucket, str(s.data_path))
    with _lock:
        if _store is None or _store_config != config:
            if s.supabase_storage_enabled:
                _store = SupabaseStore(s.supabase_url, config[1], s.supabase_storage_bucket)
                logger.info("Document storage: Supabase bucket %r", s.supabase_storage_bucket)
            else:
                _store = LocalStore(s.data_path)
                logger.info("Document storage: local files under %s", s.data_path)
            _store_config = config
        return _store


def reset() -> None:
    """Forget the cached store (tests)."""
    global _store, _store_config
    with _lock:
        _store, _store_config = None, ()
