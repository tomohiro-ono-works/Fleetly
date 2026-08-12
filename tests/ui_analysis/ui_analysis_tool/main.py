from __future__ import annotations

import argparse

from ui_analysis_tool.analyzers.inventory_builder import build_project_inventory
from ui_analysis_tool.analyzers.flow_builder import build_execution_flow_graph, build_flow_records
from ui_analysis_tool.analyzers.state_impact_analyzer import analyze_state_impact
from ui_analysis_tool.analyzers.render_scope_analyzer import analyze_render_scope
from ui_analysis_tool.analyzers.startup_analyzer import analyze_startup_path
from ui_analysis_tool.analyzers.risk_analyzer import analyze_failure_risks
from ui_analysis_tool.analyzers.hotspot_analyzer import analyze_hotspots
from ui_analysis_tool.collectors.file_collector import collect_project_files
from ui_analysis_tool.collectors.html_collector import collect_html_inventory
from ui_analysis_tool.collectors.js_collector import collect_js_inventory
from ui_analysis_tool.config import AnalysisOptions
from ui_analysis_tool.extractors.handler_extractor import split_bindings, summarize_extracted_runtime
from ui_analysis_tool.extractors.state_extractor import extract_state_operations
from ui_analysis_tool.extractors.effect_extractor import extract_effects
from ui_analysis_tool.extractors.storage_cache_extractor import extract_storage_operations, extract_cache_operations
from ui_analysis_tool.extractors.operation_summary import summarize_state_effect_extraction
from ui_analysis_tool.extractors.source_extractor import build_source_index
from ui_analysis_tool.extractors.trigger_extractor import extract_event_bindings
from ui_analysis_tool.models import AnalysisRunSummary
from ui_analysis_tool.reporters.html_reporter import (
    write_html_inventory_report,
    write_runtime_report,
    write_state_effect_report,
    write_flow_graph_report,
    write_cross_table_report,
    write_diagnostics_report,
    write_markdown_summary,
)
from ui_analysis_tool.reporters.json_reporter import (
    write_extracted_reports,
    write_inventory_reports,
    write_analyzed_reports,
    write_table_reports,
)
from ui_analysis_tool.tables.cross_table_builder import build_main_cross_table
from ui_analysis_tool.tables.state_table_builder import build_state_impact_table
from ui_analysis_tool.tables.render_table_builder import build_render_scope_table
from ui_analysis_tool.tables.startup_table_builder import build_startup_dependency_table


def parse_cli_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="UI analysis tool - Phase 1-7 inventory, extraction, flow, tables, diagnostics")
    parser.add_argument("--root", required=True, help="Project root directory to scan recursively")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--exclude-dir", action="append", default=[], help="Directory name to exclude. Can be specified multiple times")
    parser.add_argument("--include-css", action="store_true", help="Include CSS files in files.json")
    parser.add_argument("--include-json", action="store_true", help="Include JSON files in files.json")
    parser.add_argument("--verbose", action="store_true", help="Print progress")
    parser.add_argument("--inventory-only", action="store_true", help="Run only Phase 1/2 inventory extraction")
    parser.add_argument("--extract-only", action="store_true", help="Run through Phase 4 only; skip Phase 5-7 graph/table/diagnostics")
    return parser.parse_args()


def run_analysis(root_path: str, out_path: str, options_raw: dict | None = None) -> AnalysisRunSummary:
    options_raw = options_raw or {}
    options = AnalysisOptions.from_raw(
        root=root_path,
        out=out_path,
        exclude_dirs=options_raw.get("exclude_dirs", []),
        include_css=bool(options_raw.get("include_css", False)),
        include_json=bool(options_raw.get("include_json", False)),
        verbose=bool(options_raw.get("verbose", False)),
    )
    inventory_only = bool(options_raw.get("inventory_only", False))
    extract_only = bool(options_raw.get("extract_only", False))
    options.out.mkdir(parents=True, exist_ok=True)

    if options.verbose:
        print(f"[1/15] collecting files under {options.root}")
    files = collect_project_files(options)

    if options.verbose:
        print("[2/15] collecting HTML inventory")
    html_pages = collect_html_inventory(files, options.root)

    if options.verbose:
        print("[3/15] collecting JS inventory")
    js_modules = collect_js_inventory(files)

    if options.verbose:
        print("[4/15] building project inventory")
    project_inventory = build_project_inventory(files, html_pages, js_modules)

    summary = AnalysisRunSummary(
        root_path=str(options.root),
        out_path=str(options.out),
        file_count=len(files),
        html_count=len([f for f in files if f.file_type == "html"]),
        js_count=len([f for f in files if f.file_type == "js"]),
        html_script_count=sum(len(p.scripts) for p in html_pages),
        resolved_script_count=sum(1 for p in html_pages for s in p.scripts if s.exists),
        unresolved_script_count=len(project_inventory.unresolved_scripts),
        function_count=sum(len(m.functions) for m in js_modules),
        canvas_node_count=sum(len(p.canvas_nodes) for p in html_pages),
    )

    if options.verbose:
        print("[5/15] writing inventory reports")
    write_inventory_reports(options.out, str(options.root), {
        "files": files,
        "html_inventory": html_pages,
        "js_inventory": js_modules,
        "project_inventory": project_inventory,
        "summary": summary,
    })
    write_html_inventory_report(options.out, summary, html_pages, js_modules, project_inventory)

    if inventory_only:
        if options.verbose:
            print("[6/15] inventory-only mode: skipping Phase 3-7 extraction")
        return summary

    if options.verbose:
        print("[6/15] building source index")
    source_index = build_source_index(html_pages, js_modules)

    if options.verbose:
        print("[7/15] extracting triggers, sources, and handlers")
    bindings = extract_event_bindings(html_pages, js_modules, source_index)
    triggers, sources, handlers = split_bindings(bindings)
    runtime_summary = summarize_extracted_runtime(bindings)
    summary.trigger_count = runtime_summary["trigger_count"]
    summary.source_count = runtime_summary["source_count"]
    summary.handler_count = runtime_summary["handler_count"]
    summary.binding_count = runtime_summary["binding_count"]
    summary.canvas_source_count = runtime_summary["canvas_source_count"]
    summary.window_source_count = runtime_summary["window_source_count"]
    summary.document_source_count = runtime_summary["document_source_count"]

    if options.verbose:
        print("[8/15] writing extracted runtime reports")
    write_extracted_reports(options.out, str(options.root), {
        "triggers": triggers,
        "sources": sources,
        "handlers": handlers,
        "bindings": bindings,
        "summary": runtime_summary,
    })
    write_runtime_report(options.out, summary, bindings)

    if options.verbose:
        print("[9/15] extracting state operations")
    state_operations = extract_state_operations(bindings, js_modules)

    if options.verbose:
        print("[10/15] extracting effects, storage, and cache operations")
    effects = extract_effects(bindings, js_modules)
    storage_ops = extract_storage_operations(bindings, js_modules)
    cache_ops = extract_cache_operations(bindings, js_modules)
    state_effect_summary = summarize_state_effect_extraction(state_operations, effects, storage_ops, cache_ops)

    summary.state_operation_count = state_effect_summary["state_operation_count"]
    summary.effect_count = state_effect_summary["effect_count"]
    summary.storage_operation_count = state_effect_summary["storage_operation_count"]
    summary.cache_operation_count = state_effect_summary["cache_operation_count"]
    summary.canvas_redraw_effect_count = state_effect_summary["canvas_redraw_effect_count"]
    summary.layout_recalc_effect_count = state_effect_summary["layout_recalc_effect_count"]
    summary.bridge_call_effect_count = state_effect_summary["bridge_call_effect_count"]
    summary.dom_update_effect_count = state_effect_summary["dom_update_effect_count"]

    if options.verbose:
        print("[11/15] writing state/effect reports")
    write_extracted_reports(options.out, str(options.root), {
        "states": state_operations,
        "effects": effects,
        "storage_ops": storage_ops,
        "cache_ops": cache_ops,
        "state_effect_summary": state_effect_summary,
    })
    write_state_effect_report(options.out, summary, state_operations, effects, storage_ops, cache_ops)

    if extract_only:
        if options.verbose:
            print("[12/15] extract-only mode: skipping Phase 5-7 graph/table/diagnostics")
        return summary

    if options.verbose:
        print("[12/15] building execution flow graph")
    flow_graph = build_execution_flow_graph(bindings, state_operations, effects)
    flow_records = build_flow_records(flow_graph)
    write_analyzed_reports(options.out, str(options.root), {
        "flow_graph": flow_graph,
        "flow_records": flow_records,
    })
    write_flow_graph_report(options.out, flow_graph)

    if options.verbose:
        print("[13/15] building cross tables")
    state_impact = analyze_state_impact(flow_graph)
    render_scope = analyze_render_scope(flow_graph)
    startup_analysis = analyze_startup_path(project_inventory, flow_graph)
    main_cross_table = build_main_cross_table(flow_graph)
    state_impact_table = build_state_impact_table(state_impact)
    render_scope_table = build_render_scope_table(render_scope)
    startup_dependency_table = build_startup_dependency_table(startup_analysis)
    write_table_reports(options.out, str(options.root), {
        "main_cross_table": main_cross_table,
        "state_impact_table": state_impact_table,
        "render_scope_table": render_scope_table,
        "startup_dependency_table": startup_dependency_table,
    })
    write_cross_table_report(options.out, main_cross_table, render_scope_table, state_impact_table)

    if options.verbose:
        print("[14/15] running diagnostics")
    risk_analysis = analyze_failure_risks(flow_graph)
    hotspot_analysis = analyze_hotspots(flow_graph)
    write_analyzed_reports(options.out, str(options.root), {
        "state_impact": state_impact,
        "render_scope": render_scope,
        "startup_analysis": startup_analysis,
        "risk_analysis": risk_analysis,
        "hotspot_analysis": hotspot_analysis,
    })
    write_diagnostics_report(options.out, state_impact, render_scope, startup_analysis, risk_analysis, hotspot_analysis)

    if options.verbose:
        print("[15/15] writing AI summary markdown")
    write_markdown_summary(options.out, flow_graph, render_scope, risk_analysis, hotspot_analysis)

    if options.verbose:
        print(f"done: {options.out}")
    return summary


def main() -> None:
    args = parse_cli_args()
    summary = run_analysis(
        root_path=args.root,
        out_path=args.out,
        options_raw={
            "exclude_dirs": args.exclude_dir,
            "include_css": args.include_css,
            "include_json": args.include_json,
            "verbose": args.verbose,
            "inventory_only": args.inventory_only,
            "extract_only": args.extract_only,
        },
    )
    print(
        f"files={summary.file_count} html={summary.html_count} js={summary.js_count} "
        f"functions={summary.function_count} triggers={summary.trigger_count} handlers={summary.handler_count} "
        f"states={summary.state_operation_count} effects={summary.effect_count} "
        f"canvas_sources={summary.canvas_source_count} out={summary.out_path}"
    )


if __name__ == "__main__":
    main()
