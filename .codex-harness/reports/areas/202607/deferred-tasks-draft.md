# 202607 後でやること 暫定版

## 位置づけ

この文書は、202607 版移行で **今すぐ実施しないが、後で必ず行う作業** をまとめる暫定メモである。

現時点では正本仕様ではなく、実装前後の作業漏れ防止リストとして扱う。

## 後でやる理由

Playwright の全面 baseline は、UI 再設計と localhost 化の後に行う。

現時点の Playwright は `file://`、QWebChannel、旧 AppShell、旧 canvas、旧 config 前提のため、全面実行しても移行後の判定基準として使いにくい。

## 後でやること

| 順番 | タスク | 実施タイミング | 成果物 |
| --- | --- | --- | --- |
| 1 | Playwright 全面 baseline | localhost server + 新 UI の通常表示が動いた後 | 既知失敗一覧、成功/失敗 summary |
| 2 | localhost 向け smoke test 固定 | AppShell / WorkflowDesigner / catalog API 接続後 | smoke spec 一式 |
| 3 | security test 固定 | localhost API security middleware 実装後 | token、Origin/Referer、CORS、POST 制約 test |
| 4 | lifecycle test 固定 | server 起動/停止実装後 | random port、session token、server stop test |
| 5 | screenshot baseline | 新 UI の主要画面が安定した後 | home、workspace、dataflow、data area の screenshot |
| 6 | 旧経路削除確認 | localhost 経路が通った後 | QWebChannel、`file://`、旧 bridge 依存の削除チェック |
| 7 | Playwright 既知失敗の再分類 | 全面 baseline 後 | 既知失敗 / 新規回帰 / 削除対象 spec の分類 |

## 後でやる Playwright の対象

最低限、次を localhost URL 前提で確認する。

- home 起動
- project select
- workspace root 選択
- workspace tree 表示
- flow load/save
- dataflow 画面表示
- node 選択
- right panel 表示
- data area 表示
- run start/cancel/result summary
- AppShell smoke
- WorkflowDesigner smoke

## security test の対象

- token 無し API request が拒否されること。
- 不正 token が拒否されること。
- 不正 Origin/Referer が拒否されること。
- CORS wildcard が返らないこと。
- 状態変更 API が `GET` で実行されないこと。
- 状態変更 API が JSON 以外の content-type で実行されないこと。
- dangerous API が security profile と確認を通ること。

## 今はやらないこと

- Playwright 全 spec の全面実行。
- 旧 `file://` 前提の screenshot baseline 固定。
- QWebChannel 前提の失敗調査の深掘り。
- UI 再設計前の visual regression 固定。

## 今やること

`static/config/config.js` の参照箇所を catalog 移行タスクへ分解した。

成果物は `catalog-config-migration-breakdown.md` を参照する。

`bridge.py` の handler を localhost API route/service 単位へ分解した。

成果物は `bridge-route-service-breakdown.md` を参照する。

backend 実装前の route/service 単位タスクを `.codex-harness/tasks/` へ落とした。

成果物:

- `005-202607-localhost-server-skeleton.md`
- `006-202607-security-middleware.md`
- `009-202607-catalog-qwebchannel.md`
- `010-202607-workspace-documents-qwebchannel.md`

次にやる作業は、`005-202607-localhost-server-skeleton.md` から実装に入るか、run/result/events と host API の後続タスクを追加すること。

## 完了条件

この暫定メモは、localhost server + 新 UI で Playwright baseline を取り直した時点で、正式な baseline report または test strategy へ統合する。
