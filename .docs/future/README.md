# Future Specs

## 位置づけ

このディレクトリは、現行実装の正本ではなく、202607 版以降の移行先仕様を置く。

現行仕様の正本は `.docs/architecture.md`、`.docs/coding-rules.md`、`.docs/refactor-policy.md`、`.docs/areas/` とする。

## 202607 版仕様

| ファイル | 役割 |
| --- | --- |
| `202607-overview.md` | 全体構成、責務境界、PySide WebView/QWebChannel 方針 |
| `202607-current-axis-gap.md` | 現行仕様を 202607 軸へ写像した変更点・不整合 |
| `202607-design-questionnaire.md` | 詳細設計の質問、回答、確定事項 |
| `202607-qwebchannel-bridge.md` | QWebChannel bridge の公開境界と command 一覧 |
| `202607-qwebchannel-contract.md` | JSON command/response/event schema の分類索引 |
| `qwebchannel/` | QWebChannel command分類別request／response／event schema |
| `qwebchannel/security-policy-profile.md` | QWebChannel command別security policy profile |
| `202607-qwebchannel-security.md` | WebView/QWebChannel の security 仕様 |
| `202607-task-plan.md` | 202607 仕様タスクの順序 |
| `202607-detailed-design-task-plan.md` | 202607 詳細設計タスクの章別計画 |
| `202607-catalog-config-delivery.md` | catalog/config の正本と配信方式 |
| `202607-appshell-api.md` | AppShell の public API |
| `202607-workflow-designer-api.md` | WorkflowDesigner の public API |
| `202607-zizd-format.md` | `.zizd` ファイル形式、step_id、実行グラフ |
| `202607-column-schema.md` | Excel/CSV 等のカラム指定、型指定、rename、スキーマ読込 |
| `202607-runtime-data-lifetime.md` | workflow 実行中の DataFrame 初期化、保持、解放、data area cache |
| `202607-gui-backend-structure.md` | desktop host、QWebChannel、service、runtime の実装構成 |
| `202607-service-runtime-interface.md` | application service／runtime manager内部IFの意味的契約 |
| `202607-implementation-sequence.md` | JS／Python／QWebChannel の具体的な実装順序 |
| `202607-frontend-library.md` | 再利用フロントライブラリ仕様 |
| `202607-frontend-app.md` | zizai アプリ専用フロント仕様 |
| `202607-state-ux.md` | 状態管理、再描画、UX 最適化仕様 |
| `202607-legacy-path-removal.md` | 旧 bridge 直呼び、責務混在、旧 config の削除仕様 |
| `202607-migration-plan.md` | 移行順序、リスク、検証方針 |
| `202607-ui-js-refactor.md` | 初期草案。分割後は上記ファイルを優先する |

## 読む順番

1. `202607-overview.md`
2. `202607-current-axis-gap.md`
3. `202607-design-questionnaire.md`
4. `202607-qwebchannel-bridge.md`
5. `202607-qwebchannel-contract.md`
6. `qwebchannel/common.md`
7. 必要な bridge command 分類ファイル
8. `qwebchannel/security-policy-profile.md`
9. `202607-qwebchannel-security.md`
10. `202607-gui-backend-structure.md`
11. `202607-service-runtime-interface.md`
12. `202607-task-plan.md`
13. `202607-detailed-design-task-plan.md`
14. `202607-catalog-config-delivery.md`
15. `202607-zizd-format.md`
16. `202607-yaml-style.md`
17. `202607-column-schema.md`
18. `202607-runtime-data-lifetime.md`
19. `202607-appshell-api.md`
20. `202607-workflow-designer-api.md`
21. `202607-frontend-library.md`
22. `202607-frontend-app.md`
23. `202607-state-ux.md`
24. `202607-implementation-sequence.md`
25. `202607-legacy-path-removal.md`
26. `202607-migration-plan.md`
