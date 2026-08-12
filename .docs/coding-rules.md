# coding-rules

## 役割

この文書は、実装時に守る共通コーディング規約の正本である。

## Python

- 変数・関数は `snake_case`。
- クラスは `PascalCase`。
- 定数は `UPPER_SNAKE_CASE`。
- connector の入口は `execute(action, params, context)` を維持する。
- 例外は握りつぶさず、実行エンジンへ伝播させる。
- ファイルパス処理は既存 helper を優先する。

## Connector

- `BaseConnector` を継承する。
- action 名と UI 設定は一致させる。
- 操作系 action は可能な限り 1 行 DataFrame を返す。
- 未知 action は明示的に例外にする。
- schema と serializer の責務を混在させない。
- connectorが終了を待つ外部processは`shared.process_runner.ProcessRunner`を使い、直接`subprocess.run`／`Popen`しない。
- command構築とresult変換はconnector、stream／exit code／timeout／cancel／process tree終了／mask／出力量上限は`ProcessRunner`の責務とする。
- detached起動のChrome、WebDriverが管理するSelenium、renderer libraryが管理するPlotlyは`ProcessRunner`対象外とし、例外理由をconnector仕様へ明記する。

## JavaScript

- 変数・関数は `camelCase`。
- クラスは `PascalCase`。
- `const` を優先し、再代入が必要な場合のみ `let` を使う。
- 文字列は既存コードに合わせてダブルクォートを基本にする。
- UI 状態の見た目は CSS で表現し、JS は状態計算と DOM 操作に集中する。
- グローバル公開 `window.*` は必要最小限にする。

## CSS / UI

- 色は `static/css/00_tokens.css` の token を使う。
- 新規/変更箇所から token 準拠を必須にする。
- 既存非準拠は `.codex-harness/reports/areas/static/design-rules-compliance-audit-2026-06-12.md` を参照して段階的に直す。
- semantic と interactive の状態を混在させない。
- 状態優先順位は `selected > active > hover > focus > disabled`。
- 直書きカラーは新規追加しない。
- 実行中も変化しない shell 領域は flow 描画領域と合成上も分離し、継続更新される領域に `backdrop-filter` や重い shadow を巻き込まない。
- 詳細な UI 規約の移行前原本は `.codex-harness/reports/reference/standards/design-rules.md` を参照する。

## Frontend State

- frontend module間の参照は`window.zizPackages`配下の責務別namespaceを使用し、
  同じAPIを`window`直下へ重複公開しない。
- host通信を行うapp／adapterは`zizPackages.core.bridge`だけを参照し、
  `backendBridge`を直接参照しない。
- workflow外単体実行の対象拡張子、source kind、source parameter、result mode、
  export actionはcatalogから解決する。frontendでconnector ID／action IDを条件分岐して
  payloadを組み替えない。
- 202607 frontendのdocument状態は、`.zizd`と同じparse済みdocumentを保持するapp document storeだけを正本にする。
- `WorkflowDesigner`、property panel、保存、実行のために別のnode／edge正本を作らない。
- 実行結果データの正本は backend 側の最新保持。
- `run.stepStatus` 受信ごとにデータタブ DOM を全クリアしない。
- 非同期 API 完了待ちを UI 更新の前段に置かない。
- 実行中ステータス表示は継続的な canvas アニメーションを避け、静的表示または DOM/CSS 側の軽量インジケータに限定する。
- flow canvas の実行状態は `Running` / `Success` / `ERROR` の静的ラベルで表示し、状態変化時の再描画だけで反映する。
- 詳細な状態管理メモの移行前原本は `.codex-harness/reports/reference/standards/state-management.md` を参照する。

## 検証

- Python 変更時は可能な範囲で `py_compile` を実行する。
- 単体テストは実装時に実行する。会話には詳細ログを出さず、成功/失敗の要約のみを書く。
- 結合テストは実装時に実行する。会話には詳細ログを出さず、成功/失敗の要約のみを書く。
- 共有挙動を触った場合は `tests/python` の unit test を実行する。
- 検証環境テストは、事前定義したテストケースに基づいて実装後に実行する。
- 可能な範囲で、実装時と同一環境でテストする。難しい場合は理由を明記する。
- E2E テストはスクリプトで実行し、詳細結果を `.codex-harness/reports/` 配下に保存する。
- E2E テスト結果を会話に貼り付けず、保存先・成否・重要な失敗理由のみを書く。
- UI 変更時はブラウザ確認または確認不能理由を残す。
- Playwright や Node.js の検証コードは、PowerShell のインラインコマンドや here-string で流し込まず、保存済み `.js` または Playwright spec として実行する。
