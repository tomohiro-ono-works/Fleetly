from __future__ import annotations

from html import escape
from pathlib import Path

from ui_analysis_tool.models import AnalysisRunSummary, HtmlPageRecord, JsModuleRecord, ProjectInventory


def _table(headers: list[str], rows: list[list[str]]) -> str:
    head = "".join(f"<th>{escape(h)}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{escape(str(c))}</td>" for c in row) + "</tr>"
        for row in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def write_html_inventory_report(
    out_path: Path,
    summary: AnalysisRunSummary,
    html_pages: list[HtmlPageRecord],
    js_modules: list[JsModuleRecord],
    project_inventory: ProjectInventory,
) -> None:
    reports_dir = out_path / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    page_rows = [
        [p.relative_path, str(len(p.dom_ids)), str(len(p.scripts)), str(len(p.canvas_nodes)), p.title]
        for p in html_pages
    ]
    module_rows = [
        [m.relative_path, str(len(m.functions)), str(len(m.global_assignments)), str(len(m.event_like_terms)), str(len(m.canvas_indicators))]
        for m in js_modules
    ]
    unresolved_rows = [
        [x.from_ref, x.to_ref, "; ".join(x.notes)] for x in project_inventory.unresolved_scripts
    ]

    html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>UI Analysis Inventory Report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #222; }}
    h1, h2 {{ margin-top: 1.4em; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 28px; font-size: 13px; }}
    th, td {{ border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }}
    th {{ background: #f5f5f5; text-align: left; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }}
    .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fafafa; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>UI Analysis Inventory Report</h1>
  <p>Phase 1/2: file collection, HTML inventory, JS inventory, and HTML → script link resolution.</p>
  <div class="summary">
    <div class="card"><strong>Files</strong><br>{summary.file_count}</div>
    <div class="card"><strong>HTML</strong><br>{summary.html_count}</div>
    <div class="card"><strong>JS</strong><br>{summary.js_count}</div>
    <div class="card"><strong>Scripts</strong><br>{summary.resolved_script_count}/{summary.html_script_count} resolved</div>
    <div class="card"><strong>Functions</strong><br>{summary.function_count}</div>
    <div class="card"><strong>Canvas nodes</strong><br>{summary.canvas_node_count}</div>
  </div>

  <h2>HTML Pages</h2>
  {_table(['page', 'dom_ids', 'scripts', 'canvas', 'title'], page_rows)}

  <h2>JS Modules</h2>
  {_table(['module', 'functions', 'window_assignments', 'event_terms', 'canvas_indicators'], module_rows)}

  <h2>Unresolved Scripts</h2>
  {_table(['from', 'src', 'notes'], unresolved_rows) if unresolved_rows else '<p>None</p>'}

  <h2>Output files</h2>
  <ul>
    <li><code>inventory/files.json</code></li>
    <li><code>inventory/html_inventory.json</code></li>
    <li><code>inventory/js_inventory.json</code></li>
    <li><code>inventory/project_inventory.json</code></li>
    <li><code>inventory/summary.json</code></li>
  </ul>
</body>
</html>"""
    (reports_dir / "report.html").write_text(html, encoding="utf-8")


def write_runtime_report(
    out_path: Path,
    summary: AnalysisRunSummary,
    bindings: list,
) -> None:
    reports_dir = out_path / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for b in bindings[:300]:
        rows.append([
            b.trigger.trigger_type,
            b.trigger.trigger_name,
            b.source.source_type,
            b.source.source_ref,
            b.handler.handler_name,
            b.handler.handler_kind,
            b.handler.relative_path,
            str(b.handler.start_line),
        ])
    html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>UI Analysis Runtime Extraction Report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #222; }}
    h1, h2 {{ margin-top: 1.4em; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 28px; font-size: 12px; }}
    th, td {{ border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }}
    th {{ background: #f5f5f5; text-align: left; position: sticky; top: 0; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }}
    .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fafafa; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>UI Analysis Runtime Extraction Report</h1>
  <p>Phase 3: trigger/source/handler extraction. This is static heuristic analysis.</p>
  <div class="summary">
    <div class="card"><strong>Bindings</strong><br>{summary.binding_count}</div>
    <div class="card"><strong>Triggers</strong><br>{summary.trigger_count}</div>
    <div class="card"><strong>Sources</strong><br>{summary.source_count}</div>
    <div class="card"><strong>Handlers</strong><br>{summary.handler_count}</div>
    <div class="card"><strong>Canvas sources</strong><br>{summary.canvas_source_count}</div>
    <div class="card"><strong>Window sources</strong><br>{summary.window_source_count}</div>
    <div class="card"><strong>Document sources</strong><br>{summary.document_source_count}</div>
  </div>
  <h2>Bindings preview</h2>
  {_table(['trigger_type', 'trigger', 'source_type', 'source', 'handler', 'handler_kind', 'file', 'line'], rows)}
  <h2>Output files</h2>
  <ul>
    <li><code>extracted/triggers.json</code></li>
    <li><code>extracted/sources.json</code></li>
    <li><code>extracted/handlers.json</code></li>
    <li><code>extracted/bindings.json</code></li>
    <li><code>extracted/summary.json</code></li>
  </ul>
</body>
</html>"""
    (reports_dir / "runtime_report.html").write_text(html, encoding="utf-8")


def write_state_effect_report(
    out_path: Path,
    summary: AnalysisRunSummary,
    states: list,
    effects: list,
    storage_ops: list,
    cache_ops: list,
) -> None:
    reports_dir = out_path / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    state_rows = [
        [
            s.state_kind,
            s.change_kind,
            s.state_ref,
            s.handler_id.split("::")[-1],
            s.relative_path,
            str(s.start_line),
            f"{s.confidence:.2f}",
        ]
        for s in states[:400]
    ]
    effect_rows = [
        [
            e.effect_type,
            e.effect_target,
            e.handler_id.split("::")[-1],
            e.relative_path,
            str(e.start_line),
            f"{e.confidence:.2f}",
        ]
        for e in effects[:400]
    ]
    storage_rows = [
        [s.operation, s.storage_ref, s.handler_id.split("::")[-1], s.relative_path, str(s.start_line)]
        for s in storage_ops[:200]
    ]
    cache_rows = [
        [c.operation, c.cache_ref, c.handler_id.split("::")[-1], c.relative_path, str(c.start_line)]
        for c in cache_ops[:200]
    ]

    html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>UI Analysis State / Effect Report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #222; }}
    h1, h2 {{ margin-top: 1.4em; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 28px; font-size: 12px; }}
    th, td {{ border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }}
    th {{ background: #f5f5f5; text-align: left; position: sticky; top: 0; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }}
    .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fafafa; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>UI Analysis State / Effect Report</h1>
  <p>Phase 4: state/view/storage/cache/effect extraction. This is static heuristic analysis.</p>

  <div class="summary">
    <div class="card"><strong>State ops</strong><br>{summary.state_operation_count}</div>
    <div class="card"><strong>Effects</strong><br>{summary.effect_count}</div>
    <div class="card"><strong>DOM updates</strong><br>{summary.dom_update_effect_count}</div>
    <div class="card"><strong>Canvas redraw</strong><br>{summary.canvas_redraw_effect_count}</div>
    <div class="card"><strong>Layout recalc</strong><br>{summary.layout_recalc_effect_count}</div>
    <div class="card"><strong>Bridge calls</strong><br>{summary.bridge_call_effect_count}</div>
    <div class="card"><strong>Storage ops</strong><br>{summary.storage_operation_count}</div>
    <div class="card"><strong>Cache ops</strong><br>{summary.cache_operation_count}</div>
  </div>

  <h2>State operations preview</h2>
  {_table(['state_kind', 'change', 'state_ref', 'handler', 'file', 'line', 'confidence'], state_rows)}

  <h2>Effects preview</h2>
  {_table(['effect_type', 'effect_target', 'handler', 'file', 'line', 'confidence'], effect_rows)}

  <h2>Storage operations preview</h2>
  {_table(['operation', 'storage_ref', 'handler', 'file', 'line'], storage_rows)}

  <h2>Cache operations preview</h2>
  {_table(['operation', 'cache_ref', 'handler', 'file', 'line'], cache_rows)}

  <h2>Output files</h2>
  <ul>
    <li><code>extracted/states.json</code></li>
    <li><code>extracted/effects.json</code></li>
    <li><code>extracted/storage_ops.json</code></li>
    <li><code>extracted/cache_ops.json</code></li>
    <li><code>extracted/state_effect_summary.json</code></li>
  </ul>
</body>
</html>"""
    (reports_dir / "state_effect_report.html").write_text(html, encoding="utf-8")


def write_flow_graph_report(out_path: Path, flow_graph: dict) -> None:
    reports_dir = out_path / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    summary = flow_graph.get("summary", {})
    flows = flow_graph.get("flows", [])
    rows = []
    for flow in flows[:500]:
        trigger = flow.get("trigger", {})
        source = flow.get("source", {})
        handler = flow.get("handler", {})
        rows.append([
            trigger.get("trigger_type", ""),
            trigger.get("trigger_name", ""),
            source.get("source_type", ""),
            source.get("source_ref", ""),
            handler.get("handler_name", ""),
            handler.get("file", ""),
            str(handler.get("line", "")),
            str(len(flow.get("state_reads", []))),
            str(len(flow.get("state_writes", []))),
            str(len(flow.get("effects", []))),
            ", ".join(k for k, v in flow.get("flags", {}).items() if v),
        ])
    html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>UI Analysis Flow Graph Report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #222; }}
    h1, h2 {{ margin-top: 1.4em; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 28px; font-size: 12px; }}
    th, td {{ border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }}
    th {{ background: #f5f5f5; text-align: left; position: sticky; top: 0; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }}
    .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fafafa; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>UI Analysis Flow Graph Report</h1>
  <p>Phase 5: trigger/source/handler/state/effect connection. This is static heuristic analysis.</p>
  <div class="summary">
    <div class="card"><strong>Flows</strong><br>{summary.get('flow_count', len(flows))}</div>
    <div class="card"><strong>Graph nodes</strong><br>{summary.get('node_count', 0)}</div>
    <div class="card"><strong>Graph edges</strong><br>{summary.get('edge_count', 0)}</div>
    <div class="card"><strong>State-write flows</strong><br>{summary.get('flows_with_state_write', 0)}</div>
    <div class="card"><strong>Canvas redraw flows</strong><br>{summary.get('flows_with_canvas_redraw', 0)}</div>
    <div class="card"><strong>Layout recalc flows</strong><br>{summary.get('flows_with_layout_recalc', 0)}</div>
    <div class="card"><strong>High-frequency render flows</strong><br>{summary.get('high_frequency_render_flows', 0)}</div>
  </div>
  <h2>Flow preview</h2>
  {_table(['trigger_type', 'trigger', 'source_type', 'source', 'handler', 'file', 'line', 'reads', 'writes', 'effects', 'flags'], rows)}
  <h2>Output files</h2>
  <ul>
    <li><code>analyzed/flow_graph.json</code></li>
    <li><code>analyzed/flow_records.json</code></li>
  </ul>
</body>
</html>"""
    (reports_dir / "flow_graph_report.html").write_text(html, encoding="utf-8")


def write_cross_table_report(out_path: Path, main_table: dict, render_table: dict, state_table: dict) -> None:
    reports_dir = out_path / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    rows = main_table.get("rows", [])
    columns = main_table.get("columns", [])
    cells = main_table.get("cells", [])
    preview_cols = [c.get("col_key", "") for c in columns[:12]]
    cell_index = {(c.get("row_key", ""), c.get("col_key", "")): c for c in cells}
    table_rows = []
    for row in rows[:120]:
        row_key = row.get("row_key", "")
        base = [row.get("trigger_name", ""), row.get("source_type", ""), row.get("source_ref", ""), row.get("handler_name", ""), row.get("file", ""), str(row.get("line", ""))]
        for col in preview_cols:
            cell = cell_index.get((row_key, col))
            if not cell:
                base.append("")
            else:
                writes = ", ".join(cell.get("state_writes", [])[:4])
                reads = ", ".join(cell.get("state_reads", [])[:2])
                base.append(("W:" + writes if writes else "") + ((" / R:" + reads) if reads else ""))
        table_rows.append(base)
    html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>UI Analysis Cross Table Report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #222; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 28px; font-size: 11px; }}
    th, td {{ border: 1px solid #ddd; padding: 5px 6px; vertical-align: top; }}
    th {{ background: #f5f5f5; text-align: left; position: sticky; top: 0; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }}
    .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fafafa; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>UI Analysis Cross Table Report</h1>
  <p>Phase 6: vertical axis = trigger/source/handler, horizontal axis = effect target, cell = state read/write.</p>
  <div class="summary">
    <div class="card"><strong>Rows</strong><br>{len(rows)}</div>
    <div class="card"><strong>Columns</strong><br>{len(columns)}</div>
    <div class="card"><strong>Cells</strong><br>{len(cells)}</div>
    <div class="card"><strong>State table rows</strong><br>{len(state_table.get('rows', []))}</div>
    <div class="card"><strong>Render table rows</strong><br>{len(render_table.get('rows', []))}</div>
  </div>
  <h2>Main cross table preview</h2>
  <p>First 12 effect columns only. Full data is in <code>tables/main_cross_table.json</code>.</p>
  {_table(['trigger', 'source_type', 'source', 'handler', 'file', 'line'] + preview_cols, table_rows)}
</body>
</html>"""
    (reports_dir / "cross_table_report.html").write_text(html, encoding="utf-8")


def write_diagnostics_report(out_path: Path, state_impact: list, render_scope: list, startup_analysis: list, risk_analysis: list, hotspot_analysis: list) -> None:
    reports_dir = out_path / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    hotspot_rows = [[str(r.get("score", "")), ", ".join(r.get("reasons", [])), r.get("trigger", {}).get("trigger_name", ""), r.get("source", {}).get("source_type", ""), r.get("handler", {}).get("handler_name", ""), r.get("handler", {}).get("file", ""), str(r.get("handler", {}).get("line", ""))] for r in hotspot_analysis[:100]]
    render_rows = [[str(r.get("hotspot_score", "")), r.get("trigger", {}).get("trigger_name", ""), r.get("source", {}).get("source_type", ""), r.get("handler", {}).get("handler_name", ""), ", ".join(e.get("effect_key", "") for e in r.get("render_targets", [])[:5]), "; ".join(r.get("notes", []))] for r in render_scope[:100]]
    risk_rows = [[r.get("severity", ""), r.get("title", ""), r.get("handler", {}).get("handler_name", ""), r.get("description", "")] for r in risk_analysis[:120]]
    html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>UI Analysis Diagnostics Report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #222; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 28px; font-size: 12px; }}
    th, td {{ border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }}
    th {{ background: #f5f5f5; text-align: left; position: sticky; top: 0; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }}
    .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fafafa; }}
    code {{ background: #f2f2f2; padding: 2px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>UI Analysis Diagnostics Report</h1>
  <p>Phase 7: state impact, render scope, startup path, risk, and hotspot diagnostics.</p>
  <div class="summary">
    <div class="card"><strong>State impact</strong><br>{len(state_impact)}</div>
    <div class="card"><strong>Render scope</strong><br>{len(render_scope)}</div>
    <div class="card"><strong>Startup records</strong><br>{len(startup_analysis)}</div>
    <div class="card"><strong>Risks</strong><br>{len(risk_analysis)}</div>
    <div class="card"><strong>Hotspots</strong><br>{len(hotspot_analysis)}</div>
  </div>
  <h2>Hotspots</h2>
  {_table(['score', 'reasons', 'trigger', 'source_type', 'handler', 'file', 'line'], hotspot_rows)}
  <h2>Render scope</h2>
  {_table(['score', 'trigger', 'source_type', 'handler', 'render_targets', 'notes'], render_rows)}
  <h2>Risks</h2>
  {_table(['severity', 'title', 'handler', 'description'], risk_rows)}
</body>
</html>"""
    (reports_dir / "diagnostics_report.html").write_text(html, encoding="utf-8")


def _analysis_common_prompt() -> str:
    """Prompt block embedded in summary.md for Codex / other GPTs."""
    return 'あなたは JavaScript / HTML UI パフォーマンス改善のためのコードレビュー担当です。\n以下の UI 解析レポートと JSON を読み、特に「無駄な再描画」「不要な layout recalculation」「高頻度イベントによる過剰な state 更新」を特定してください。\n\n# 目的\n\nこの解析の主目的は、UI の無駄な再描画を減らすことです。\n特に重視する問題パターンは以下です。\n\n- high_frequency_trigger → state_write → layout_recalc → canvas_redraw\n- mousemove / wheel / resize / scroll / requestAnimationFrame から過剰に描画へ到達している箇所\n- getBoundingClientRect / buildFlowModel / requestDraw / drawFlowCanvas が高頻度イベント中で繰り返される箇所\n- 状態が実質変わっていないのに requestDraw / DOM更新 / canvas再描画が走る箇所\n- window / document など広域イベントが不要に重い処理へ到達する箇所\n\n# 入力レポート\n\nまず reports/summary.md を読み、その後に以下を確認してください。\n\n- reports/diagnostics_report.html\n- reports/flow_graph_report.html\n- reports/cross_table_report.html\n- reports/state_effect_report.html\n- reports/runtime_report.html\n- reports/report.html\n\n可能なら以下の JSON も読むこと。\n\n- analyzed/hotspot_analysis.json\n- analyzed/render_scope.json\n- analyzed/flow_records.json\n- analyzed/risk_analysis.json\n- tables/main_cross_table.json\n- extracted/states.json\n- extracted/effects.json\n\n# 重要な読み取りルール\n\nこの解析は静的ヒューリスティック解析です。\nレポートの指摘を絶対視せず、必ず実コードで確認してください。\nただし、以下の条件が複数揃う箇所は優先度を高く扱ってください。\n\n- trigger が mousemove / wheel / resize / scroll / requestAnimationFrame\n- source_type が canvas / window / document / internal_bus\n- state write がある\n- canvas_redraw がある\n- layout_recalc がある\n- DOM update がある\n- handler が requestDraw / drawFlowCanvas / buildFlowModel / getBoundingClientRect / style更新へ到達する\n- diagnostics_report の score が高い\n\n特に以下の組み合わせは最重要リスクとして扱ってください。\n\nhigh_frequency_trigger + state_write + layout_recalc + canvas_redraw\n\n# 最優先で確認する対象\n\nまず diagnostics_report.html の Hotspots を確認してください。\nscore 上位から順に見て、以下のような箇所を優先してください。\n\n- canvas mousemove\n- wheel\n- window resize\n- requestAnimationFrame\n- window mousemove\n- scroll / resize による positionList\n- buildFlowModel に到達する resize / layout処理\n- getBoundingClientRect を高頻度イベント中で呼ぶ処理\n- requestDraw を連続発火させる処理\n\n特に ui.node.canvas.js 系の canvas 操作は最優先で確認してください。\n\n# 無駄な再描画の判断基準\n\n以下に該当する場合、無駄な再描画の疑いが強いです。\n\n1. mousemove のたびに requestDraw している\n2. hover対象が変わっていないのに requestDraw している\n3. drop対象が変わっていないのに requestDraw している\n4. dragしていないのに window mousemove handler が重い処理をしている\n5. wheel のたびに layout再計算や canvas再描画を直接行っている\n6. resize のたびに buildFlowModel や requestDraw を連続実行している\n7. requestDraw が requestAnimationFrame を多重予約している\n8. getBoundingClientRect を mousemove / wheel / scroll 中に毎回呼んでいる\n9. state write 後に、変更有無を比較せず描画している\n10. DOM style / classList 更新が差分判定なしに繰り返されている\n\n# 推奨する改善方針\n\n実コードを確認したうえで、以下の最小差分を優先してください。\n\n1. requestDraw の rAF gate\n   - drawScheduled / drawDirty を持つ\n   - requestAnimationFrame が既に予約済みなら追加予約しない\n   - 1フレーム内の複数 requestDraw を 1回の drawFlowCanvas にまとめる\n\n2. mousemove の差分判定\n   - hoverControl / dropControl / dragState / selection / viewport が変わった時だけ描画する\n   - 変化がない場合は return する\n\n3. getBoundingClientRect のキャッシュ\n   - mousemove / wheel / scroll 中に毎回呼ばない\n   - resize / zoom / container layout change / canvas再作成 / layout rebuild のタイミングで更新する\n\n4. wheel の rAF 集約\n   - wheel は viewport値の更新だけ行い、描画は requestDraw 経由で rAF にまとめる\n\n5. resize の debounce\n   - buildFlowModel / requestDraw / DOM再配置を resizeイベントごとに直接呼ばない\n\n6. window mousemove の guard\n   - ドラッグ中でない場合に即 return する\n\n# やってはいけないこと\n\n- レポートの score だけを見て、実コード確認なしに修正しない\n- 挙動変更を伴う大規模リファクタをいきなり行わない\n- canvas描画ロジック全体を書き換えない\n- state構造を大きく変えない\n- UI仕様を推測で変更しない\n- line番号だけを絶対視しない。handler名と周辺処理も確認する\n- 初期表示改善やbundle削減に論点を広げすぎない\n\n# 出力形式\n\n以下の形式で回答してください。\n\n## 1. 解析結果の要約\n\n- 最重要ホットスポット\n- なぜ問題か\n- どのイベントが原因か\n- どの state / effect に到達しているか\n\n## 2. 優先度付き課題一覧\n\n表形式で出してください。\n列: Priority / File / Handler or Line / Trigger / Source / Problem / Evidence from reports / Recommended fix / Risk\n\n## 3. 実コード確認結果\n\n各ホットスポットについて以下を確認してください。\n\n- requestDraw を呼んでいるか\n- drawFlowCanvas を直接呼んでいるか\n- getBoundingClientRect を呼んでいるか\n- buildFlowModel を呼んでいるか\n- state write があるか\n- 差分判定があるか\n- rAF gate があるか\n- debounce があるか\n\n## 4. 修正方針\n\n最小差分で、以下の順に提案してください。\n\n1. requestDraw の多重予約防止\n2. mousemove の差分判定\n3. getBoundingClientRect のキャッシュ化\n4. wheel の rAF 集約\n5. resize の debounce\n6. window mousemove の drag guard\n\n## 5. 変更案\n\n実装する場合は最小パッチにしてください。\n変更前後で、どの再描画・layout再計算が減る想定か説明してください。\n\n## 6. 検証方法\n\n修正後に以下を確認してください。\n\n- canvas mousemove で状態が変わらない時に requestDraw が呼ばれない\n- requestDraw が 1フレーム1回に集約される\n- wheel連続操作で drawFlowCanvas が過剰に呼ばれない\n- resize連続操作で buildFlowModel が連続実行されない\n- 既存UI操作が壊れていない\n- 再度 ui_analysis_tool を実行し、high-frequency render flows / canvas redraw flows / layout recalc flows が減るか確認する\n\n# 最終目的\n\n目的はコードの見た目をきれいにすることではありません。\n以下を減らすことです。\n\n- 不要な canvas redraw\n- 不要な DOM update\n- 不要な layout recalculation\n- 高頻度イベント中の不要な state write\n- 1フレーム内の多重 requestDraw\n'


def write_markdown_summary(out_path: Path, flow_graph: dict, render_scope: list, risk_analysis: list, hotspot_analysis: list) -> None:
    reports_dir = out_path / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    lines = []
    lines.append("# UI Analysis Summary")
    lines.append("")
    lines.append("This file is intended as the first document for Codex / other GPTs. Read this summary first, then inspect the HTML reports, JSON outputs, and the actual source code.")
    lines.append("")
    summary = flow_graph.get("summary", {})
    lines.append("## Flow summary")
    for k, v in summary.items():
        lines.append(f"- {k}: {v}")
    lines.append("")
    lines.append("## Primary objective")
    lines.append("- Reduce unnecessary redraw, especially canvas redraw and layout recalculation caused by high-frequency events.")
    lines.append("- Highest-risk pattern: `high_frequency_trigger -> state_write -> layout_recalc -> canvas_redraw`.")
    lines.append("- Treat this report as static heuristic analysis; verify every finding against the actual source code before editing.")
    lines.append("")
    lines.append("## Top hotspots")
    for r in hotspot_analysis[:20]:
        h = r.get("handler", {})
        t = r.get("trigger", {})
        s = r.get("source", {})
        lines.append(f"- score={r.get('score')}: {t.get('trigger_name')} > {s.get('source_type')} > {h.get('handler_name')} ({h.get('file')}:{h.get('line')}) reasons={','.join(r.get('reasons', []))}")
    lines.append("")
    lines.append("## Top render scope records")
    for r in render_scope[:20]:
        h = r.get("handler", {})
        t = r.get("trigger", {})
        s = r.get("source", {})
        targets = ", ".join(e.get("effect_key", "") for e in r.get("render_targets", [])[:5])
        notes = "; ".join(r.get("notes", [])[:3])
        lines.append(f"- score={r.get('hotspot_score')}: {t.get('trigger_name')} > {s.get('source_type')} > {h.get('handler_name')} ({h.get('file')}:{h.get('line')}) -> {targets} | {notes}")
    lines.append("")
    lines.append("## Risks")
    for r in risk_analysis[:30]:
        lines.append(f"- [{r.get('severity')}] {r.get('title')}: {r.get('description')}")
    lines.append("")
    lines.append("## Reports and JSON to inspect next")
    lines.extend([
        "- reports/diagnostics_report.html",
        "- reports/flow_graph_report.html",
        "- reports/cross_table_report.html",
        "- reports/state_effect_report.html",
        "- reports/runtime_report.html",
        "- analyzed/hotspot_analysis.json",
        "- analyzed/render_scope.json",
        "- analyzed/flow_records.json",
        "- tables/main_cross_table.json",
        "- extracted/states.json",
        "- extracted/effects.json",
    ])
    lines.append("")
    lines.append("## Common prompt for Codex / other GPTs")
    lines.append("")
    lines.append("Use the following prompt when asking another model or Codex to read this analysis correctly.")
    lines.append("")
    lines.append("```text")
    lines.append(_analysis_common_prompt().rstrip())
    lines.append("```")
    lines.append("")
    (reports_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")