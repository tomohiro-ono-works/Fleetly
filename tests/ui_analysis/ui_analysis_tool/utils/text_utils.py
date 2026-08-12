from __future__ import annotations

import re


def line_no_at(text: str, index: int) -> int:
    return text.count("\n", 0, max(index, 0)) + 1


def compact_ws(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()
