"""Generated exports (BRD 2.8 / 2.9 / S2): stored as objects in the document
store with a relational record; regeneration replaces; erasure removes both;
legacy on-disk exports still download."""

from sqlalchemy import select

from app.core import db
from app.core.config import get_settings
from app.db.engine import session_scope
from app.db.models import Export
from app.services import exports as exports_svc
from tests.test_presentation import make_request


def _row(project_id: str, fmt: str) -> Export | None:
    with session_scope() as session:
        row = session.get(Export, (project_id, fmt))
        if row is not None:
            session.expunge(row)
        return row


def test_export_is_an_object_plus_a_record_and_regeneration_replaces_it(client):
    payload = make_request().model_dump()
    res = client.post("/generate-presentation?format=pptx&project_id=p-exp-store", json=payload)
    assert res.status_code == 200

    row = _row("p-exp-store", "pptx")
    assert row is not None
    assert row.storage_key == "projects/p-exp-store/exports/pptx.pptx"
    assert row.storage_backend == "local" and row.size_bytes == len(res.content)
    assert row.content_type.startswith("application/vnd.openxmlformats")
    assert row.filename == "Credit Insurance Presentation of Terms - Aldgate Timber Ltd.pptx"
    assert row.generated_by  # the signed-in broker
    stored = get_settings().data_path / "projects" / "p-exp-store" / "exports" / "pptx.pptx"
    assert stored.read_bytes() == res.content
    first_at = row.created_at

    # Regenerating overwrites the same object and row — no versioning (BRD 2.8).
    again = client.post("/generate-presentation?format=pptx&project_id=p-exp-store",
                        json=dict(payload, client_name="Aldgate Timber Limited"))
    assert again.status_code == 200
    with session_scope() as session:
        rows = session.scalars(select(Export).where(Export.project_id == "p-exp-store")).all()
        assert [r.format for r in rows] == ["pptx"]
        assert rows[0].created_at >= first_at
        assert "Limited" in rows[0].filename
    assert stored.read_bytes() == again.content

    download = client.get("/projects/p-exp-store/exports/pptx")
    assert download.status_code == 200 and download.content == again.content
    assert "Aldgate Timber Limited" in download.headers["content-disposition"]

    # Erasure removes the record (cascade) and the object.
    assert client.delete("/projects/p-exp-store").status_code == 204
    assert _row("p-exp-store", "pptx") is None
    assert not stored.exists()
    assert client.get("/projects/p-exp-store/exports/pptx").status_code == 404


def test_each_format_has_its_own_object(client):
    payload = make_request().model_dump()
    for fmt in ("pptx", "pdf", "limits-xlsx"):
        assert client.post(f"/generate-presentation?format={fmt}&project_id=p-exp-fmt",
                           json=payload).status_code == 200
    with session_scope() as session:
        keys = sorted(exports_svc.storage_keys_for_project(session, "p-exp-fmt"))
    assert keys == [
        "projects/p-exp-fmt/exports/limits-xlsx.xlsx",
        "projects/p-exp-fmt/exports/pdf.pdf",
        "projects/p-exp-fmt/exports/pptx.pptx",
    ]
    assert client.get("/projects/p-exp-fmt/exports/pdf").headers["content-type"] == "application/pdf"
    client.delete("/projects/p-exp-fmt")


def test_missing_object_is_a_404_not_a_crash(client):
    payload = make_request().model_dump()
    assert client.post("/generate-presentation?format=pdf&project_id=p-exp-gone",
                       json=payload).status_code == 200
    (get_settings().data_path / "projects" / "p-exp-gone" / "exports" / "pdf.pdf").unlink()
    res = client.get("/projects/p-exp-gone/exports/pdf")
    assert res.status_code == 404 and res.json()["detail"] == "Export file missing."
    assert client.get("/projects/p-exp-gone/exports/pdf/page/1").status_code == 404
    client.delete("/projects/p-exp-gone")


def test_legacy_on_disk_export_still_downloads(client, tmp_path):
    """Exports generated before the relational table: a SQLite row pointing
    at a file. Read-only compatibility, cleaned up by the project delete."""
    assert client.put("/projects/p-exp-legacy", json={"client_name": "Legacy"}).status_code == 201
    path = tmp_path / "old.pptx"
    path.write_bytes(b"old deck bytes")
    db.execute("INSERT INTO exports (project_id, format, filename, stored_path, created) "
               "VALUES (?,?,?,?,?)", ("p-exp-legacy", "pptx", "Old.pptx", str(path), db.now()))
    res = client.get("/projects/p-exp-legacy/exports/pptx")
    assert res.status_code == 200 and res.content == b"old deck bytes"
    assert 'filename="Old.pptx"' in res.headers["content-disposition"]
    assert client.get("/projects/p-exp-legacy/exports/pdf").status_code == 404
    client.delete("/projects/p-exp-legacy")
    assert db.query_one("SELECT 1 FROM exports WHERE project_id=?", ("p-exp-legacy",)) is None


def test_object_key_is_one_per_format():
    assert exports_svc.object_key("p1", "limits-xlsx") == "projects/p1/exports/limits-xlsx.xlsx"
    try:
        exports_svc.object_key("p1", "docx")
    except ValueError:
        pass
    else:  # pragma: no cover
        raise AssertionError("unknown formats must be refused")
