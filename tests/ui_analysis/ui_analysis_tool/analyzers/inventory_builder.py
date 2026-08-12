from __future__ import annotations

from pathlib import Path
from typing import List

from ui_analysis_tool.models import FileRecord, HtmlPageRecord, JsModuleRecord, ProjectInventory, ProjectLinkRecord


def build_project_inventory(
    files: List[FileRecord],
    html_pages: List[HtmlPageRecord],
    js_modules: List[JsModuleRecord],
) -> ProjectInventory:
    module_ids = {m.relative_path for m in js_modules}
    links: List[ProjectLinkRecord] = []
    unresolved: List[ProjectLinkRecord] = []

    for page in html_pages:
        for script in page.scripts:
            if script.exists and script.relative_resolved_path:
                link = ProjectLinkRecord(
                    from_ref=page.relative_path,
                    to_ref=script.relative_resolved_path,
                    link_type="html_script",
                    exists=script.relative_resolved_path in module_ids,
                    notes=[] if script.relative_resolved_path in module_ids else ["script file exists but was not classified as JS module"],
                )
                links.append(link)
            else:
                link = ProjectLinkRecord(
                    from_ref=page.relative_path,
                    to_ref=script.src,
                    link_type="html_script_unresolved",
                    exists=False,
                    notes=["script src could not be resolved as a local file"],
                )
                unresolved.append(link)

    html_script_count = sum(len(p.scripts) for p in html_pages)
    resolved_script_count = sum(1 for p in html_pages for s in p.scripts if s.exists)
    canvas_count = sum(len(p.canvas_nodes) for p in html_pages)
    function_count = sum(len(m.functions) for m in js_modules)

    return ProjectInventory(
        pages=[p.relative_path for p in html_pages],
        modules=[m.relative_path for m in js_modules],
        links=links,
        unresolved_scripts=unresolved,
        counts={
            "files": len(files),
            "html": len([f for f in files if f.file_type == "html"]),
            "js": len([f for f in files if f.file_type == "js"]),
            "html_scripts": html_script_count,
            "resolved_scripts": resolved_script_count,
            "unresolved_scripts": len(unresolved),
            "canvas_nodes": canvas_count,
            "functions": function_count,
        },
    )
