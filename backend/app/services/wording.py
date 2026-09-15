"""
Config-driven wording normalisation (BRD 2.3 terminology mapping; Feedback
Round 1, B3).

Some insurers state a term as a sentence that the presentation shows in a
short standard form — Nexus: "Open credit not exceeding 60 days from end of
month of invoice" -> "60 days end of month". The rules live in the mapping
library (config/terminology.json `rules`, or the admin-saved terminology
document), keyed by insurer id (or "*" for every insurer) and standard
field: a case-insensitive regular expression with named groups, and a
render template using those groups, so the figure itself (the day count)
is always the document's own — never inferred.

Applied after the verification pass, so the value was verified against
the page as extracted; the page link and confidence are untouched.
"""

import re

from app.models.schemas import QuoteExtraction, sourced_items
from app.services.library import wording_rules


def apply_rule(value: str, rules: list[dict]) -> str:
    """The first matching rule's rendering, else the value unchanged."""
    for rule in rules:
        match = re.search(rule["match"], value, re.IGNORECASE)
        if match:
            groups = {k: (v or "") for k, v in match.groupdict().items()}
            return rule["render"].format(**groups).strip()
    return value


def apply_wording_rules(extraction: QuoteExtraction, insurer_id: str | None,
                        rules: dict | None = None) -> list[str]:
    """Rewrite each extracted value that matches a rule for this insurer
    (insurer-specific rules first, then the "*" section). Returns the
    field names that changed."""
    library = rules if rules is not None else wording_rules()
    sections = [s for s in (library.get(insurer_id or ""), library.get("*")) if s]
    changed: list[str] = []
    for field, item in sourced_items(extraction):
        if not item.value:
            continue
        for section in sections:
            field_rules = section.get(field) or []
            rendered = apply_rule(item.value, field_rules)
            if rendered != item.value:
                item.value = rendered
                changed.append(field)
                break
    return changed
