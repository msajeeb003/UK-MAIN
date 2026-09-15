"""
One-off data maintenance for saved projects.

    python -m app.maintenance rename-columns            # apply
    python -m app.maintenance rename-columns --dry-run  # report only

`rename-columns` re-labels comparison columns after a display-name change
in config/insurers.json (Feedback Round 1, A2 / A3: "Allianz Trade" →
"Allianz", legal wording → "Coface"). A column is renamed only when it was
identified as a standing-list insurer AND its current heading is one of
that insurer's names (canonical, legal, or the name recorded at
extraction) — a heading the broker typed themselves is left alone (BRD:
every field is editable). Free-format columns are never touched; an
expiring-policy column keeps its "Expiring — " prefix.
"""

import argparse
import logging
import sys

from sqlalchemy import select

from app.db.engine import session_scope
from app.db.models import Project
from app.services import projects as projects_repo
from app.services.library import get_insurers, match_insurer

logger = logging.getLogger(__name__)

EXPIRING_PREFIX = "Expiring — "


def _known_names(insurer: dict) -> set[str]:
    return {n.lower() for n in (insurer["name"], *insurer.get("legal_names", []))}


def _document_wording(col: dict, files: list[dict]) -> bool:
    """True when the heading is the insurer name the document itself used —
    the upload card records that wording ("<name> (matched: X) · quote …")."""
    name = str(col.get("name") or "")
    for card in files:
        if isinstance(card, dict) and card.get("docId") and card.get("docId") == col.get("docId"):
            meta = str(card.get("meta") or "")
            if meta.startswith(name + " (matched:") or meta.startswith(name + " · "):
                return True
    return False


def rename_column(col: dict, files: list[dict] | None = None) -> dict | None:
    """The renamed column, or None when nothing should change."""
    if not isinstance(col, dict) or col.get("manual"):
        return None
    name = str(col.get("name") or "")
    expiring = bool(col.get("expiring")) or name.startswith(EXPIRING_PREFIX)
    bare = name[len(EXPIRING_PREFIX):] if name.startswith(EXPIRING_PREFIX) else name
    insurer = match_insurer(col.get("matched")) or match_insurer(bare)
    if insurer is None:
        return None
    known = _known_names(insurer) | {str(col.get("matched") or "").lower()} - {""}
    if bare.lower() not in known and not _document_wording({**col, "name": bare}, files or []):
        return None                                   # broker-typed heading: keep it
    target = (EXPIRING_PREFIX + insurer["name"]) if expiring else insurer["name"]
    if name == target and col.get("matched") == insurer["name"]:
        return None
    return {**col, "name": target, "matched": insurer["name"]}


def rename_columns(dry_run: bool = False) -> list[tuple[str, str, str]]:
    """Apply to every saved project. Returns (project id, old name, new name)."""
    changes: list[tuple[str, str, str]] = []
    with session_scope() as session:
        for project in session.scalars(select(Project)):
            state = project.state or {}
            columns = state.get("columns")
            if not isinstance(columns, list):
                continue
            files = state.get("files") if isinstance(state.get("files"), list) else []
            renamed = False
            new_columns = []
            for col in columns:
                nxt = rename_column(col, files)
                if nxt is not None:
                    changes.append((project.id, str(col.get("name") or ""), nxt["name"]))
                    renamed = True
                    new_columns.append(nxt)
                else:
                    new_columns.append(col)
            if renamed and not dry_run:
                with projects_repo.project_lock(project.id):
                    fresh = projects_repo.require(session, project.id, for_update=True)
                    projects_repo.patch(session, project.id,
                                        {"state": {**(fresh.state or {}), "columns": new_columns}},
                                        "maintenance")
    return changes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    rc = sub.add_parser("rename-columns", help="re-label columns after an insurer display-name change")
    rc.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "rename-columns":
        changes = rename_columns(dry_run=args.dry_run)
        for pid, old, new in changes:
            print(f"{pid}: {old!r} -> {new!r}")
        print(f"{len(changes)} column(s) {'would be' if args.dry_run else ''} renamed "
              f"across {len({c[0] for c in changes})} project(s); standing list: "
              + ", ".join(i["name"] for i in get_insurers()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
