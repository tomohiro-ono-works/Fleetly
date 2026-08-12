# refactor-policy

## 役割

この文書は、削除・整理・責務分離を進めるときの正本である。
目的は再構築ではなく、不要コード・重複コード・責務が曖昧なコード・現在の思想に合わないコードを見つけて小さく整理すること。

## ドキュメント配置

| 場所 | 役割 |
| --- | --- |
| `AGENTS.md` | 常時守る作業ルール |
| `.codex/` | Codex 設定と sub-agent 定義 |
| `.agents/skills/` | 再利用する作業手順 |
| `.codex-harness/tasks/` | 今回の作業指示 |
| `.codex-harness/scripts/` | 機械的に実行する解析・検証 |
| `.codex-harness/checks/` | 完了判定・確認項目 |
| `.codex-harness/reports/` | Codex の調査出力・過去ログ |
| `.codex-harness/reports/reference/` | 正本へ全文統合しにくい詳細資料・移行前原本 |
| `.docs/` | 設計思想・規約の正本 |
| `.docs/areas/` | 責務範囲ごとの実装仕様 |

## 読む順番

1. `AGENTS.md`
2. `.docs/architecture.md`
3. `.docs/coding-rules.md`
4. `.docs/refactor-policy.md`
5. 対象責務の仕様がある場合は `.docs/areas/`
6. 対象 task がある場合は `.codex-harness/tasks/`
7. 過去調査が必要な場合だけ `.codex-harness/reports/`
8. 詳細原本の確認が必要な場合だけ `.codex-harness/reports/reference/`

## 削除・整理分類

| 種別 | 意味 |
| --- | --- |
| 未使用候補 | 参照元が見つからない |
| 重複候補 | 同じ責務が複数箇所にある |
| 旧仕様候補 | 現行方針と違う仕様を前提にしている |
| デバッグ/暫定候補 | 一時的な検証・ログ・試作が残っている |
| 責務混在 | 複数責務が1ファイル/関数に集中している |
| 思想違反 | 現行の設計思想と矛盾する |
| 判断保留 | 削除判断に必要な根拠が不足している |

## リスク分類

- 低: 参照なし、または履歴/試作で実行経路に乗らない。
- 中: 設定や UI から間接参照される可能性がある。
- 高: 実行エンジン、bridge、workspace 操作、データ破壊操作に関わる。

## 進め方

1. 対象範囲を1フォルダまたは1責務に絞る。
2. `rg` で参照元を確認する。
3. 入口、export、主要関数、依存関係を確認する。
4. 削除候補と判断保留を分ける。
5. 低リスクから実装する。
6. 変更後に参照切れとテストを確認する。
7. 結果を `.codex-harness/reports/` に残す。

## 禁止事項

- 全面再構築を整理タスクに混ぜない。
- 不確かなものを削除候補にしない。
- 過去の `.codex-harness/reports/` を現行仕様として扱わない。
- 旧互換をユーザー確認なしに復活させない。

## 現行判断

- `.zizd` を正式保存形式にする。
- `.zizw` 互換は持たない。
- Query Builder / SQLBuilder / `.zizq` 専用ロジックは削除済み扱い。
- `bin/ziz.bat` は正式起動手順として維持する。
- `VectorConnector` は実装済み機能として維持する。実 Ruri モデルでの手動スモーク確認は残件として扱う。
- `workspace.delete` は正式 API として維持するが、安全性強化対象にする。
