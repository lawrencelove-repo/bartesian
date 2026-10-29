"""
UTF-8 JSON helpers for data/*.json.

Python's json.dumps defaults to ensure_ascii=True, which turns ñ into \\u00f1
(and similarly for other non-ASCII). Always use these helpers (or pass
ensure_ascii=False) when writing catalog JSON so names like \"Jalapeño\" stay
readable in git diffs.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Union

PathLike = Union[str, Path]


def read_json(path: PathLike) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: PathLike, data: Any, *, indent: int = 2) -> None:
    Path(path).write_text(
        json.dumps(data, indent=indent, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
