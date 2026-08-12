# 004 Analyze static

## Objective

`static/` の UI 構成、責務混在、design-rules 非準拠を確認する。

## Scope

- 対象: `static/`
- 主な観点: HTML entry, `static/js`, `static/css`, UI tokens

## Additional Task

### Workspace tab layout simplification

- `workspace` のタブ左右表示機能を廃止する。
- タブ機能自体は残し、最大 4 つまで開けるようにする。
- 表示中のタブは常に 1 つだけをアクティブにする。
- `右ペインへ移動` など、左右ペイン前提の操作導線を削除する。
- ノード詳細用の右サイドバーは別責務として維持する。
- 対象候補: `static/js/workspace.shell.js`, `static/js/workspace.manager.js`, `static/css/06_workspace.css`
- 期待効果: 複数 flow iframe/canvas の同時表示を避け、shell と flow 描画領域の合成負荷を下げる。

## Output

- 既存レポート: `.codex-harness/reports/areas/source-cleanup/audits/static-source-cleanup-audit-2026-06-09.md`
- design-rules 棚卸し: `.codex-harness/reports/areas/static/design-rules-compliance-audit-2026-06-12.md`
