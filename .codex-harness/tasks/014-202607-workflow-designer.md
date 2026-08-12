# 014 202607 WorkflowDesigner

## Objective

`.zizd`と同じ`steps`、`flows`、`unassigned`、`loop.flows`を直接扱う再利用可能な`createWorkflowDesigner()` instance APIを実装する。

canvas、selection、viewport、hit test、graph editing、loop、sticky note、status overlayをlibraryへ置き、catalog、property form、QWebChannel、保存／実行はZizai app adapterへ残す。

## Scope

- library:
  - `static/js/workflow-designer/`
  - `static/css/workflow-designer.css`
- public API:
  - mount／destroy
  - document／selection／viewport／status／readonly／renderer更新
  - fitView／duplicate／copy／paste
  - event購読
- graph:
  - 複数flowのSTART／END／step／edge
  - unassigned仮START／部分graph
  - loop owner／内部step／loop edge
  - sticky note／annotation
- editing:
  - select、multi-select、node／note移動、pan、zoom、fit
  - connect request、delete request、run request、detail request
  - 標準ID発番、node／flow複製、cross-document fragment
  - 共通graph参照更新、app固有reference rewriter
- Zizai adapter boundary:
  - catalog由来node renderer
  - property detail／run／delete／external linkのpublic request event

## Out Of Scope

- YAML parse／serialize
- connector／action／params／schemaの意味解釈
- property form renderer本体
- QWebChannel／BridgeClient呼出し
- workflow runtime／scheduler
- app tab／save／history policy
- production app document storeへの切替
- 旧canvas public経路の削除
- 旧`nodes`／`parentId` graphとの互換変換

## References

- `.docs/future/202607-workflow-designer-api.md`
- `.docs/future/202607-zizd-format.md`
- `.docs/future/202607-frontend-library.md`
- `.docs/future/202607-frontend-app.md`
- `.docs/future/202607-state-ux.md`

## Implementation Stages

1. document／selection／viewport／event／patch contractを実装する。
2. `.zizd` graphからrender modelを作る。
3. DOM／SVG rendererとnode renderer adapterを実装する。
4. select／drag／pan／zoom／connect interactionを実装する。
5. ID allocator、duplicate、copy／paste、reference rewriteを実装する。
6. loop／unassigned／sticky note／status overlayを実装する。
7. standalone fixtureでbackend非依存の再利用testを通す。
8. Zizai catalog renderer adapterを実装する。
9. production app document store切替と旧canvas削除はphase 8／11で行う。

## Acceptance Criteria

- public APIが正本に沿う。
- `.zizd` graph topologyを別の保存用node／edge形状へ変換しない。
- library内にconnector／action catalog、BridgeClient、YAML、app固有form処理がない。
- documentはcontrolled inputで、編集は1 transactionの`document:change`を通知する。
- selection／viewport／status更新でdocument全体を再生成しない。
- 複数flow、loop、unassigned、sticky noteが同一canvasに描画される。
- standard allocatorでstep／flow IDを別々に`01`から発番できる。
- node／flow複製とpasteで共通graph参照が更新される。
- custom renderer／idAllocator／referenceRewriterを差し替えられる。
- QWebChannelなしのstandalone fixtureで主要操作が通る。
- libraryが旧`window.uiNode*`を参照または公開しない。

## Verification

- core:
  - document snapshot／patch／inverse patch
  - selection／viewport／status／readonly
  - standard／custom allocator
  - duplicate／copy／paste／rollback
- DOM:
  - node／edge／loop／unassigned／note描画
  - drag／pan／zoom／fit／connect
  - keyboard／focus／context command
  - status／validation overlay
- app integration:
  - catalog renderer
  - detail／delete／run event
  - multi-document isolation
  - save／reload後のgraph維持
- static:
  - app固有dependencyなし
  - internal module原則300行以内
  - JavaScript syntax check
  - `git diff --check`
