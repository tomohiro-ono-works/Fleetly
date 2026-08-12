from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Tuple

from ui_analysis_tool.models import FileRecord, HtmlPageRecord, HtmlScriptRef
from ui_analysis_tool.utils.path_utils import resolve_local_ref, safe_relative
from ui_analysis_tool.utils.text_utils import compact_ws


class InventoryHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.dom_ids: List[str] = []
        self.data_attrs: Dict[str, Dict[str, str]] = {}
        self.body_dataset: Dict[str, str] = {}
        self.scripts: List[str] = []
        self.inline_script_count = 0
        self.canvas_nodes: List[str] = []
        self.title = ""
        self._in_title = False
        self._in_script_without_src = False

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        attr = {k.lower(): (v if v is not None else "") for k, v in attrs}
        dom_id = attr.get("id", "")
        if dom_id:
            self.dom_ids.append(dom_id)
        data = {k[5:]: v for k, v in attr.items() if k.startswith("data-")}
        if data:
            ref = dom_id or f"{tag_l}[{len(self.data_attrs)}]"
            self.data_attrs[ref] = data
        if tag_l == "body" and data:
            self.body_dataset = data
        if tag_l == "script":
            src = attr.get("src", "")
            if src:
                self.scripts.append(src)
            else:
                self._in_script_without_src = True
        if tag_l == "canvas":
            self.canvas_nodes.append(dom_id or f"canvas[{len(self.canvas_nodes)}]")
        if tag_l == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l == "title":
            self._in_title = False
        if tag_l == "script" and self._in_script_without_src:
            self.inline_script_count += 1
            self._in_script_without_src = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def collect_html_inventory(files: List[FileRecord], project_root: Path) -> List[HtmlPageRecord]:
    pages: List[HtmlPageRecord] = []
    for f in files:
        if f.file_type != "html":
            continue
        path = Path(f.file_path)
        text = path.read_text(encoding="utf-8", errors="replace")
        parser = InventoryHtmlParser()
        parser.feed(text)
        scripts: List[HtmlScriptRef] = []
        for i, src in enumerate(parser.scripts):
            resolved = resolve_local_ref(path, project_root, src)
            exists = bool(resolved and resolved.exists())
            scripts.append(
                HtmlScriptRef(
                    src=src,
                    resolved_path=str(resolved) if resolved else "",
                    relative_resolved_path=safe_relative(resolved, project_root) if resolved and exists else "",
                    exists=exists,
                    order=i,
                )
            )
        pages.append(
            HtmlPageRecord(
                page_id=f.relative_path,
                file_path=f.file_path,
                relative_path=f.relative_path,
                title=compact_ws(parser.title),
                body_dataset=parser.body_dataset,
                dom_ids=sorted(set(parser.dom_ids)),
                scripts=scripts,
                inline_script_count=parser.inline_script_count,
                canvas_nodes=sorted(set(parser.canvas_nodes)),
                data_attrs=parser.data_attrs,
            )
        )
    return pages
