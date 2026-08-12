# 202607 仕様タスク計画

## 位置づけ

この文書は、202607 版仕様を順番に詰めるためのタスク一覧である。

実装タスクではなく、実装前に固定する仕様タスクを管理する。

## タスク順

| 順番 | タスク | 目的 | 成果物 | 状態 |
| --- | --- | --- | --- | --- |
| 1 | catalog/config 配信方式 | `static/config/config.js` の肥大化を解消し、分類・form・policy の正本を決める | `202607-catalog-config-delivery.md` | 完了 |
| 2 | AppShell public API | VSCode ライクな shell、tab、sidebar、topbar の再利用境界を決める | `202607-appshell-api.md` | 完了 |
| 3 | WorkflowDesigner public API | workflow component の入出力、選択、編集、状態表示の境界を決める | `202607-workflow-designer-api.md` | 完了 |
| 4 | QWebChannel / GUI backend 実装構成 | WebView、transport、dispatcher、application service、runtime を分ける単位を決める | `202607-qwebchannel-bridge.md`、`202607-qwebchannel-contract.md`、`202607-qwebchannel-security.md`、`202607-gui-backend-structure.md` | 完了 |
| 5 | 移行順序の具体化 | JS と Python の改修順、検証順、削除順を決める | `202607-implementation-sequence.md` | 完了 |

## 完了済み前提

- 全体構成: `202607-overview.md`
- 現行仕様写像: `202607-current-axis-gap.md`
- QWebChannel command 一覧: `202607-qwebchannel-bridge.md`
- QWebChannel schema分類: `202607-qwebchannel-contract.md`、`qwebchannel/`
- command別security profile: `qwebchannel/security-policy-profile.md`
- GUI backend 責務分離: `202607-gui-backend-structure.md`

## 進め方

- 1 タスクごとに 1 文書を追加する。
- 文書は原則 300 行以内にする。
- 既存文書には参照だけ追加し、詳細を重複させない。
- 未決事項は次タスクへ移す。
- 仕様が固まったものから実装候補へ送る。

## 状態

202607 版の基盤仕様タスクは完了している。章別の詳細設計と不整合確認は `202607-detailed-design-task-plan.md` と `202607-design-questionnaire.md` で継続する。
