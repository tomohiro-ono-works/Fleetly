#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
rename_pdf_by_text_v2.py

JSONルールに従って、対象フォルダ内のPDFをファイル名あいまい検索で探し、
PDF本文に search_text が含まれる場合だけ rename_file_path へ移動/コピーします。

Install:
    pip install pypdf

Run:
    python rename_pdf_by_text_v2.py --config rename_pdf_rules_folder_fuzzy.json

Dry-run:
    python rename_pdf_by_text_v2.py --config rename_pdf_rules_folder_fuzzy.json --dry-run

Copy:
    python rename_pdf_by_text_v2.py --config rename_pdf_rules_folder_fuzzy.json --copy

JSON:
[
  {
    "target_folder_path": "xxxxxx\\Downloads",
    "target_file_name": "goal",
    "search_text": "Virginia",
    "rename_file_path": "xxxxxx\\Downloads\\renamed\\B2VB2026_Week_7_Virginia_goal.pdf"
  }
]

仕様:
- target_folder_path: PDFを探すフォルダ
- target_file_name: PDFファイル名のあいまい検索文字列。拡張子なしでも可
- search_text: PDF本文に含まれているべき文字列
- rename_file_path: 一致したPDFの移動/コピー先
- ファイル名検索は NFKC正規化 + 大文字小文字無視 + 空白正規化
- 完全/部分一致を優先し、なければ類似度で候補を探す
- 同じPDFを複数ルールで使わない
"""

from __future__ import annotations

import argparse
import csv
import difflib
import glob
import json
import os
import re
import shutil
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


@dataclass
class Rule:
    no: int
    target_folder_path: str
    target_file_name: str
    search_text: str
    rename_file_path: str


@dataclass
class Candidate:
    path: Path
    score: float


@dataclass
class Result:
    rule_no: int
    target_folder_path: str
    target_file_name: str
    search_text: str
    matched: bool
    source_pdf: str
    rename_file_path: str
    filename_score: float
    action: str
    error: str


def expand_path(path_text: str) -> str:
    return os.path.expandvars(os.path.expanduser(path_text))


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_for_match(text: str) -> str:
    return normalize_text(text).casefold()


def read_pdf_text(pdf_path: Path, max_pages: int | None = None) -> str:
    reader = PdfReader(str(pdf_path))
    pages = reader.pages

    if max_pages is not None:
        pages = pages[:max_pages]

    texts: list[str] = []
    for page_index, page in enumerate(pages, start=1):
        try:
            texts.append(page.extract_text() or "")
        except Exception as e:
            texts.append(f"\n[PAGE {page_index} EXTRACT ERROR] {type(e).__name__}: {e}\n")

    return "\n".join(texts)


def load_rules(config_path: Path) -> list[Rule]:
    raw = json.loads(config_path.read_text(encoding="utf-8"))

    if not isinstance(raw, list):
        raise ValueError("JSONのトップレベルは配列にしてください。")

    required = ["target_folder_path", "target_file_name", "search_text", "rename_file_path"]
    rules: list[Rule] = []

    for i, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"{i}件目がオブジェクトではありません。")

        missing = [k for k in required if k not in item]
        if missing:
            raise ValueError(f"{i}件目に必須項目がありません: {missing}")

        rules.append(
            Rule(
                no=i,
                target_folder_path=str(item["target_folder_path"]),
                target_file_name=str(item["target_file_name"]),
                search_text=str(item["search_text"]),
                rename_file_path=str(item["rename_file_path"]),
            )
        )

    return rules


def filename_score(file_path: Path, query: str) -> float:
    """
    0-100でファイル名一致度を返す。
    - 完全一致: 100
    - 部分一致: 90以上
    - その他: difflib類似度
    """
    q = normalize_for_match(Path(query).stem)
    stem = normalize_for_match(file_path.stem)
    name = normalize_for_match(file_path.name)

    if not q:
        return 0.0

    if q == stem or q == name:
        return 100.0

    if q in stem:
        # 長さが近いほど少し高くする
        return 90.0 + min(9.0, len(q) / max(len(stem), 1) * 9.0)

    if q in name:
        return 88.0

    return difflib.SequenceMatcher(None, q, stem).ratio() * 100.0


def find_filename_candidates(
    folder_path: str,
    file_name_query: str,
    min_score: float,
    used_sources: set[Path],
) -> list[Candidate]:
    folder = Path(expand_path(folder_path))

    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"対象フォルダが存在しません: {folder}")

    pdfs = [Path(p) for p in glob.glob(str(folder / "*.pdf"))]

    candidates: list[Candidate] = []
    for pdf in pdfs:
        resolved = pdf.resolve()
        if resolved in used_sources:
            continue

        score = filename_score(pdf, file_name_query)
        if score >= min_score:
            candidates.append(Candidate(path=pdf, score=score))

    # スコア降順、同点なら更新日時の新しい順
    candidates.sort(key=lambda c: (c.score, c.path.stat().st_mtime), reverse=True)
    return candidates


def pdf_contains_text(
    pdf_path: Path,
    search_text: str,
    max_pages: int | None,
    case_sensitive: bool,
) -> bool:
    pdf_text = read_pdf_text(pdf_path, max_pages=max_pages)

    haystack = normalize_text(pdf_text)
    needle = normalize_text(search_text)

    if not case_sensitive:
        haystack = haystack.casefold()
        needle = needle.casefold()

    return needle in haystack


def ensure_pdf_suffix(path: Path) -> Path:
    if path.suffix.lower() != ".pdf":
        return path.with_suffix(".pdf")
    return path


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path

    for i in range(1, 10000):
        candidate = path.with_name(f"{path.stem}_{i:03d}{path.suffix}")
        if not candidate.exists():
            return candidate

    raise RuntimeError(f"空きファイル名を作れません: {path}")


def apply_rule(
    rule: Rule,
    min_score: float,
    max_pages: int | None,
    case_sensitive: bool,
    copy_mode: bool,
    overwrite: bool,
    dry_run: bool,
    used_sources: set[Path],
) -> Result:
    try:
        candidates = find_filename_candidates(
            folder_path=rule.target_folder_path,
            file_name_query=rule.target_file_name,
            min_score=min_score,
            used_sources=used_sources,
        )
    except Exception as e:
        return Result(
            rule_no=rule.no,
            target_folder_path=rule.target_folder_path,
            target_file_name=rule.target_file_name,
            search_text=rule.search_text,
            matched=False,
            source_pdf="",
            rename_file_path=expand_path(rule.rename_file_path),
            filename_score=0.0,
            action="find_error",
            error=f"{type(e).__name__}: {e}",
        )

    if not candidates:
        return Result(
            rule_no=rule.no,
            target_folder_path=rule.target_folder_path,
            target_file_name=rule.target_file_name,
            search_text=rule.search_text,
            matched=False,
            source_pdf="",
            rename_file_path=expand_path(rule.rename_file_path),
            filename_score=0.0,
            action="no_filename_match",
            error=f"ファイル名候補がありません: {rule.target_file_name}",
        )

    read_errors: list[str] = []

    for candidate in candidates:
        try:
            if not pdf_contains_text(
                pdf_path=candidate.path,
                search_text=rule.search_text,
                max_pages=max_pages,
                case_sensitive=case_sensitive,
            ):
                continue
        except Exception as e:
            read_errors.append(f"{candidate.path.name}: {type(e).__name__}: {e}")
            continue

        dest = ensure_pdf_suffix(Path(expand_path(rule.rename_file_path)))
        dest.parent.mkdir(parents=True, exist_ok=True)

        if not overwrite:
            dest = unique_path(dest)

        if dry_run:
            action = "dry_run_copy" if copy_mode else "dry_run_move"
        else:
            if copy_mode:
                shutil.copy2(candidate.path, dest)
                action = "copied"
            else:
                shutil.move(str(candidate.path), str(dest))
                action = "moved"

            used_sources.add(candidate.path.resolve())

        return Result(
            rule_no=rule.no,
            target_folder_path=rule.target_folder_path,
            target_file_name=rule.target_file_name,
            search_text=rule.search_text,
            matched=True,
            source_pdf=str(candidate.path),
            rename_file_path=str(dest),
            filename_score=round(candidate.score, 2),
            action=action,
            error="",
        )

    return Result(
        rule_no=rule.no,
        target_folder_path=rule.target_folder_path,
        target_file_name=rule.target_file_name,
        search_text=rule.search_text,
        matched=False,
        source_pdf="",
        rename_file_path=expand_path(rule.rename_file_path),
        filename_score=round(candidates[0].score, 2),
        action="text_not_matched",
        error="ファイル名候補はありましたが、PDF本文のsearch_textに一致しません。" + (" / " + " | ".join(read_errors) if read_errors else ""),
    )


def write_report(results: list[Result], report_path: Path) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)

    with report_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "rule_no",
                "target_folder_path",
                "target_file_name",
                "search_text",
                "matched",
                "source_pdf",
                "rename_file_path",
                "filename_score",
                "action",
                "error",
            ],
        )
        writer.writeheader()

        for r in results:
            writer.writerow({
                "rule_no": r.rule_no,
                "target_folder_path": r.target_folder_path,
                "target_file_name": r.target_file_name,
                "search_text": r.search_text,
                "matched": r.matched,
                "source_pdf": r.source_pdf,
                "rename_file_path": r.rename_file_path,
                "filename_score": r.filename_score,
                "action": r.action,
                "error": r.error,
            })


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="対象フォルダ内PDFをファイル名あいまい検索し、本文文字列一致でリネーム/移動します。"
    )
    parser.add_argument("--config", required=True, help="ルールJSONファイルパス")
    parser.add_argument("--min-score", type=float, default=60.0, help="ファイル名あいまい検索の最低スコア。既定: 60")
    parser.add_argument("--max-pages", type=int, default=None, help="先頭Nページだけ検索。未指定なら全ページ。")
    parser.add_argument("--case-sensitive", action="store_true", help="本文検索で大文字小文字を区別する。")
    parser.add_argument("--copy", action="store_true", help="移動ではなくコピーする。")
    parser.add_argument("--overwrite", action="store_true", help="出力先が既にある場合に上書きする。")
    parser.add_argument("--dry-run", action="store_true", help="実際の移動/コピーをせず判定だけ行う。")
    parser.add_argument("--report", default="rename_pdf_report_v2.csv", help="処理結果CSVの出力先。")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = Path(expand_path(args.config))

    try:
        rules = load_rules(config_path)
    except Exception as e:
        print(f"[ERROR] JSON読み込み失敗: {e}", file=sys.stderr)
        return 1

    print(f"[INFO] rules: {len(rules)}")
    print(f"[INFO] config: {config_path}")
    print(f"[INFO] min_score: {args.min_score}")
    print(f"[INFO] mode: {'copy' if args.copy else 'move'}")
    print(f"[INFO] dry_run: {args.dry_run}")

    results: list[Result] = []
    used_sources: set[Path] = set()

    for rule in rules:
        print(f"[RULE {rule.no}] file_name~={rule.target_file_name} / search_text={rule.search_text}")

        result = apply_rule(
            rule=rule,
            min_score=args.min_score,
            max_pages=args.max_pages,
            case_sensitive=args.case_sensitive,
            copy_mode=args.copy,
            overwrite=args.overwrite,
            dry_run=args.dry_run,
            used_sources=used_sources,
        )
        results.append(result)

        if result.matched:
            print(f"  MATCH: {result.source_pdf}")
            print(f"  score: {result.filename_score}")
            print(f"  {result.action}: {result.rename_file_path}")
        else:
            print(f"  NO MATCH: {result.action} / {result.error}")

    report_path = Path(expand_path(args.report))
    write_report(results, report_path)
    print(f"[DONE] report: {report_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
