あなたは JavaScript / HTML UI パフォーマンス改善のためのコードレビュー担当です。
以下の UI 解析レポートを読み、特に「無駄な再描画」「不要な layout recalculation」「高頻度イベントによる過剰な state 更新」を特定してください。

# 目的

この解析の主目的は、UI の無駄な再描画を減らすことです。

特に重視する問題パターンは以下です。

- high_frequency_trigger → state_write → layout_recalc → canvas_redraw
- mousemove / wheel / resize / scroll / requestAnimationFrame から過剰に描画へ到達している箇所
- getBoundingClientRect / buildFlowModel / requestDraw / drawFlowCanvas が高頻度イベント中で繰り返される箇所
- 状態が実質変わっていないのに requestDraw / DOM更新 / canvas再描画が走る箇所
- window / document など広域イベントが不要に重い処理へ到達する箇所

# 入力レポート

以下のレポートを読むこと。

- report.html
  - ファイル・HTML・JS目録
  - script参照解決状況
  - JSごとの functions / window_assignments / event_terms / canvas_indicators

- runtime_report.html
  - trigger / source / handler 抽出
  - canvas / window / document / internal_bus / external_interface の起点確認

- state_effect_report.html
  - state read/write
  - DOM update
  - canvas redraw
  - layout recalculation
  - bridge / native / cache / storage 操作

- flow_graph_report.html
  - trigger → source → handler → state → effect の接続
  - high_frequency_render_flows
  - canvas_redraw_flows
  - layout_recalc_flows
  - state_write_flows

- cross_table_report.html
  - 縦軸: trigger / source / handler
  - 横軸: effect target
  - セル: state read/write
  - どの発火点がどの影響対象へ届くかを見る

- diagnostics_report.html
  - hotspot
  - render_scope
  - state_impact
  - startup
  - risk

可能なら、HTMLレポートだけでなく以下のJSONも読むこと。

- analyzed/hotspot_analysis.json
- analyzed/render_scope.json
- analyzed/flow_records.json
- analyzed/risk_analysis.json
- tables/main_cross_table.json
- extracted/states.json
- extracted/effects.json

# 重要な読み取りルール

この解析は静的ヒューリスティック解析である。
したがって、レポートの指摘をそのまま絶対視せず、必ず実コードで確認すること。

ただし、以下の条件が複数揃う箇所は優先度を高く扱う。

- trigger が mousemove / wheel / resize / scroll / requestAnimationFrame
- source_type が canvas / window / document / internal_bus
- state write がある
- canvas_redraw がある
- layout_recalc がある
- DOM update がある
- handler が requestDraw / drawFlowCanvas / buildFlowModel / getBoundingClientRect / style更新へ到達する
- diagnostics_report の score が高い

特に以下の組み合わせは最重要リスクとして扱う。

high_frequency_trigger + state_write + layout_recalc + canvas_redraw

# 最優先で確認する対象

まず diagnostics_report.html の Hotspots を確認すること。
score 上位から順に見て、以下のような箇所を優先する。

- canvas mousemove
- wheel
- window resize
- requestAnimationFrame
- window mousemove
- scroll / resize による positionList
- buildFlowModel に到達する resize / layout処理
- getBoundingClientRect を高頻度イベント中で呼ぶ処理
- requestDraw を連続発火させる処理

特に `ui.node.canvas.js` 系の canvas 操作は最優先で確認すること。

# 無駄な再描画の判断基準

以下に該当する場合、無駄な再描画の疑いが強い。

1. mousemove のたびに requestDraw している
2. hover対象が変わっていないのに requestDraw している
3. drop対象が変わっていないのに requestDraw している
4. dragしていないのに window mousemove handler が重い処理をしている
5. wheel のたびに layout再計算や canvas再描画を直接行っている
6. resize のたびに buildFlowModel や requestDraw を連続実行している
7. requestDraw が requestAnimationFrame を多重予約している
8. getBoundingClientRect を mousemove / wheel / scroll 中に毎回呼んでいる
9. state write 後に、変更有無を比較せず描画している
10. DOM style / classList 更新が差分判定なしに繰り返されている

# 推奨する改善方針

実コードを確認したうえで、以下の最小差分を優先する。

## 1. requestDraw の rAF gate

requestDraw は 1フレーム1回に集約すること。

理想:

- drawScheduled flag を持つ
- drawDirty flag を持つ
- requestAnimationFrame が既に予約済みなら追加予約しない
- 1フレーム内の複数 requestDraw を 1回の drawFlowCanvas にまとめる

## 2. mousemove の差分判定

mousemove では、状態が変わった時だけ描画すること。

例:

- hoverControl が変わった
- dropControl が変わった
- dragState が有効
- selection が変わった
- viewport が変わった

変化がない場合は return する。

## 3. getBoundingClientRect のキャッシュ

mousemove / wheel / scroll 中に getBoundingClientRect を毎回呼ばない。

- resize
- zoom
- container layout change
- canvas再作成
- layout rebuild

などのタイミングで rect を更新し、通常イベントではキャッシュを使う。

## 4. wheel の rAF 集約

wheel は viewport値の更新だけ行い、描画は requestDraw 経由で rAF にまとめる。

避けるべき形:

wheel → getBoundingClientRect → buildFlowModel → drawFlowCanvas

望ましい形:

wheel → viewport更新 → requestDraw

## 5. resize の debounce

resize は連続発火するため、buildFlowModel / requestDraw / DOM再配置を debounce する。

特に buildFlowModel のような重い処理は、resizeイベントごとに直接呼ばない。

## 6. window mousemove の guard

window mousemove handler は、ドラッグ中でない場合に即 return する。

例:

- detailPanelDragState がない
- rightSidebarDragState がない
- canvasDragState がない
- stickyNoteDragState がない

この場合は処理しない。

# やってはいけないこと

- レポートの score だけを見て、実コード確認なしに修正しない
- 挙動変更を伴う大規模リファクタをいきなり行わない
- canvas描画ロジック全体を書き換えない
- state構造を大きく変えない
- UI仕様を推測で変更しない
- line番号だけを絶対視しない。コード変更でずれる可能性があるため、handler名と周辺処理も確認する
- 初期表示改善やbundle削減に論点を広げすぎない。今回の主目的は無駄な再描画削減

# 出力形式

以下の形式で回答すること。

## 1. 解析結果の要約

- 最重要ホットスポット
- なぜ問題か
- どのイベントが原因か
- どの state / effect に到達しているか

## 2. 優先度付き課題一覧

表形式で出すこと。

列:

- Priority
- File
- Handler / Line
- Trigger
- Source
- Problem
- Evidence from reports
- Recommended fix
- Risk

## 3. 実コード確認結果

各ホットスポットについて、実コードで以下を確認すること。

- requestDraw を呼んでいるか
- drawFlowCanvas を直接呼んでいるか
- getBoundingClientRect を呼んでいるか
- buildFlowModel を呼んでいるか
- state write があるか
- 差分判定があるか
- rAF gate があるか
- debounce があるか

## 4. 修正方針

最小差分で、以下の順に提案すること。

1. requestDraw の多重予約防止
2. mousemove の差分判定
3. getBoundingClientRect のキャッシュ化
4. wheel の rAF 集約
5. resize の debounce
6. window mousemove の drag guard

## 5. 変更案

実装する場合は、最小パッチにすること。
変更前後で、どの再描画・layout再計算が減る想定か説明すること。

## 6. 検証方法

修正後に以下を確認すること。

- canvas mousemove で状態が変わらない時に requestDraw が呼ばれない
- requestDraw が 1フレーム1回に集約される
- wheel連続操作で drawFlowCanvas が過剰に呼ばれない
- resize連続操作で buildFlowModel が連続実行されない
- 既存UI操作が壊れていない
- 再度 ui_analysis_tool を実行し、high-frequency render flows / canvas redraw flows / layout recalc flows が減るか確認する

# 最終目的

この作業の最終目的は、コードの見た目をきれいにすることではない。
目的は、以下を減らすことである。

- 不要な canvas redraw
- 不要な DOM update
- 不要な layout recalculation
- 高頻度イベント中の不要な state write
- 1フレーム内の多重 requestDraw

必ず「無駄な再描画を減らす」という目的に沿って判断すること。