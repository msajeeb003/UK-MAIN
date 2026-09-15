"""
Corpus evaluation for per-insurer format tuning.

BRD success measure "insurer formats supported: 6 — source: test corpus";
PRD pilot scope "process six sample input formats … normalise terms". Run
the sample quotes through the real pipeline and score each insurer's
format field by field, so prompt and mapping changes (config/terminology.json
`fields` and per-insurer `insurers` sections, config/insurers.json aliases)
can be iterated against evidence rather than by eye.

Corpus layout — one folder per insurer id, an expected-values file next
to each sample document::

    corpus/allianz/quote-2026.pdf
    corpus/allianz/quote-2026.expected.json
    corpus/atradius/limits.xlsx
    corpus/atradius/limits.expected.json

    {
      "insurer": "Allianz Trade",            # standing-list name (matched via aliases)
      "document_type": "insurer_quote",      # optional
      "fields": {"indemnity": "90%", "excess": "£1,000", "max_extension_period": ""},
      "buyers": 12                           # optional: expected credit-limit rows
    }

A field expected to be blank is "" (or null): the pipeline must return
nothing for it — a value there counts as a miss (BRD: blank, never guessed).
Fields not listed are not scored. Values are compared after normalising
whitespace, case and thousands separators, so "GBP 12,600" == "£12,600".

Usage (sends the documents to the configured LLM provider — real calls,
real cost, client data; run only on the approved provider posture)::

    python -m app.eval corpus/                       # every insurer folder
    python -m app.eval corpus/ --insurer atradius    # one insurer
    python -m app.eval corpus/ --engine azure        # force OCR routing
    python -m app.eval corpus/ --report eval.json    # machine-readable output

Exit code 0 when every document processed, 1 when any failed to process.
"""

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

from app.services.library import match_insurer
from app.services.pipeline import run_extraction_pipeline

DOC_SUFFIXES = {".pdf", ".xlsx", ".xls"}


def normalise(value: str | None) -> str:
    """Comparison form: lowercase, single spaces, no currency/thousand marks."""
    text = (value or "").strip().lower()
    text = re.sub(r"[£$€]|gbp|usd|eur", "", text)
    text = text.replace(",", "")
    return re.sub(r"\s+", " ", text).strip()


def score_document(expected: dict, result) -> dict:
    """Per-field outcome for one document: hit / miss / blank-expected-but-filled."""
    data = result.data
    fields: dict[str, dict] = {}
    for name, want in (expected.get("fields") or {}).items():
        item = getattr(data, name, None)
        got = item.value if item is not None and hasattr(item, "value") else None
        ok = normalise(want) == normalise(got)
        fields[name] = {
            "expected": want, "got": got, "ok": ok,
            "page": getattr(item, "page", None),
            "confidence": getattr(item, "confidence", None),
        }
    out = {"fields": fields, "hits": sum(f["ok"] for f in fields.values()), "scored": len(fields)}
    if "insurer" in expected:
        matched = match_insurer(data.insurer.value)
        out["insurer_ok"] = bool(matched) and matched["name"] == expected["insurer"]
        out["insurer_got"] = data.insurer.value
    if "document_type" in expected:
        out["document_type_ok"] = data.document_type == expected["document_type"]
    if "buyers" in expected:
        out["buyers_ok"] = len(data.buyer_credit_limits) == int(expected["buyers"])
        out["buyers_got"] = len(data.buyer_credit_limits)
    out["unverified"] = list(result.review.unverified_fields)
    out["uncertain"] = list(result.review.uncertain_fields)
    out["missing"] = list(result.review.missing_fields)
    out["engine"] = result.meta.extraction_engine
    out["steps"] = {s.step: s.ms for s in result.meta.steps}
    return out


def _documents(root: Path, only: str | None) -> list[tuple[str, Path, Path]]:
    found = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        if only and folder.name != only:
            continue
        for doc in sorted(folder.iterdir()):
            if doc.suffix.lower() in DOC_SUFFIXES:
                expected = doc.with_suffix(".expected.json")
                if expected.exists():
                    found.append((folder.name, doc, expected))
    return found


async def _run(doc: Path, engine: str):
    kind = "excel" if doc.suffix.lower() in (".xlsx", ".xls") else "pdf"
    return await run_extraction_pipeline(doc.read_bytes(), doc.name, engine=engine, file_kind=kind)


def evaluate(root: Path, *, only: str | None = None, engine: str = "auto") -> dict:
    report: dict = {"insurers": {}, "documents": [], "errors": []}
    for insurer_id, doc, expected_path in _documents(root, only):
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        started = time.monotonic()
        try:
            result = asyncio.run(_run(doc, engine))
        except Exception as exc:  # noqa: BLE001 — every failure is part of the report
            report["errors"].append({"insurer": insurer_id, "file": doc.name, "error": f"{type(exc).__name__}: {exc}"})
            continue
        scored = score_document(expected, result)
        scored.update({"insurer": insurer_id, "file": doc.name,
                       "seconds": round(time.monotonic() - started, 1)})
        report["documents"].append(scored)
        bucket = report["insurers"].setdefault(
            insurer_id, {"documents": 0, "hits": 0, "scored": 0, "fields": {}})
        bucket["documents"] += 1
        bucket["hits"] += scored["hits"]
        bucket["scored"] += scored["scored"]
        for name, f in scored["fields"].items():
            fb = bucket["fields"].setdefault(name, {"hits": 0, "scored": 0})
            fb["scored"] += 1
            fb["hits"] += int(f["ok"])
    return report


def print_report(report: dict) -> None:
    for insurer_id, b in report["insurers"].items():
        pct = 100.0 * b["hits"] / b["scored"] if b["scored"] else 0.0
        print(f"\n{insurer_id}: {b['documents']} document(s), {b['hits']}/{b['scored']} fields ({pct:.0f}%)")
        for name, fb in sorted(b["fields"].items()):
            flag = "" if fb["hits"] == fb["scored"] else "  <-- tune"
            print(f"  {name:36s} {fb['hits']}/{fb['scored']}{flag}")
    for d in report["documents"]:
        extras = []
        if "insurer_ok" in d:
            extras.append(f"insurer {'ok' if d['insurer_ok'] else 'MISS (' + str(d['insurer_got']) + ')'}")
        if "buyers_ok" in d:
            extras.append(f"buyers {'ok' if d['buyers_ok'] else 'MISS (' + str(d['buyers_got']) + ')'}")
        print(f"\n{d['insurer']}/{d['file']} — {d['engine']}, {d['seconds']}s; "
              + "; ".join(extras) + f"; unverified={len(d['unverified'])}, uncertain={len(d['uncertain'])}")
        for name, f in d["fields"].items():
            if not f["ok"]:
                print(f"  {name}: expected {f['expected']!r}, got {f['got']!r} (page {f['page']}, {f['confidence']})")
    for e in report["errors"]:
        print(f"\nERROR {e['insurer']}/{e['file']}: {e['error']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("corpus", type=Path, help="folder with one sub-folder per insurer id")
    parser.add_argument("--insurer", help="only this insurer folder")
    parser.add_argument("--engine", default="auto", choices=["auto", "digital", "azure", "docling"])
    parser.add_argument("--report", type=Path, help="write the full report as JSON here")
    args = parser.parse_args(argv)
    if not args.corpus.is_dir():
        parser.error(f"{args.corpus} is not a directory")
    report = evaluate(args.corpus, only=args.insurer, engine=args.engine)
    print_report(report)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nReport written to {args.report}")
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
