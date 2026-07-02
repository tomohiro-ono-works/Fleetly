# zizai

ローカル環境で動作する、PySide6 + WebView ベースのデータ加工 / ワークフロー作成アプリです。  
主な用途は、非エンジニア向けの ETL、業務自動化、SQL 作成補助です。

![zizai icon](static/img/icon2.png)

## 作業ルールと正本

- 常時ルール: [AGENTS.md](AGENTS.md)
- 設計思想・規約: [.docs/architecture.md](.docs/architecture.md), [.docs/coding-rules.md](.docs/coding-rules.md), [.docs/refactor-policy.md](.docs/refactor-policy.md)
- 作業指示: `.codex-harness/tasks/`
- 検証項目: `.codex-harness/checks/`
- 調査出力・過去ログ: `.codex-harness/reports/`
- 再利用手順: `.agents/skills/`

## 概要

`zizai` は Windows ローカル環境で動くデスクトップアプリです。  
ネイティブ側は `PySide6`、UI は `Qt WebEngine` 上の HTML / CSS / JavaScript で構成しています。

現在の主要モード:

- ワークフロー作成
- データフロー作成
- 入力フォーム作成

## 主な機能

### データフロー

- Excel / CSV / JSON / BigQuery からの読込
- Excel / CSV / JSON / BigQuery への出力
- データ加工コネクタ
  - RENAME リストからのフィールド名変更
  - 行フィルタ
- Windows 操作コネクタ
  - ファイル名変更＆移動
  - ファイル名検索
  - ファイル内文字列検索
  - Markdown 作成
- Web / Slack / Windows 操作系コネクタの一部利用

### ワークフロー

- ブラウザ操作
- Slack 操作
- Windows 操作
- API 実行

## セキュリティ方針

- WebView 自体の外部通信は制限
- 外部ナビゲーションは制限
- DevTools は通常起動では無効
- `--debug` 起動時のみ DevTools 利用可
- API / Web 接続制御は `config/security_policies.yml` で管理
  - `apis.profiles`
  - `web.allowlist`

補足:

- `api_profile.certificate` の Windows 証明書ストア実解決は未実装です

## ディレクトリ構成

```text
app/
  gui/
    bridge.py
    host.py
  main.py

connectors/
core/
config/
scripts/
static/
  css/
  img/
  icons/
  js/
  modal/
template/
workflows/
zizai.py
requirements.txt
```

主な役割:

- `zizai.py`
  - 起動エントリポイント
- `app/main.py`
  - フロー実行エンジン（ヘッドレス実行用途）
- `app/gui/host.py`
  - Qt / WebView ホスト
- `app/gui/bridge.py`
  - WebView と Python の bridge
- `connectors/`
  - コネクタ実装
- `core/`
  - 共通ロジック
- `static/`
  - フロントエンド UI

## 起動方法

Windows では通常 `bin\ziz.bat` から起動します。`.env` を有効化して `zizai.py` に引数を渡す launcher です。

```powershell
.\bin\ziz.bat
```

DevTools を有効にする場合:

```powershell
.\bin\ziz.bat --debug
```

ヘッドレス実行（タスクスケジューラ向け）:

```powershell
.\bin\ziz.bat "C:\path\to\flow.zizd"
```

直接起動する場合:

```powershell
.\.env\Scripts\python.exe zizai.py
```

Linux では `bin/ziz.sh` から起動します。Windows 版と同じく `.env` の Python に引数を渡します。

```sh
sh bin/ziz.sh
sh bin/ziz.sh --debug
sh bin/ziz.sh /path/to/flow.zizd
```

## 設定ファイル

### `config/security_policies.yml`

外部接続のポリシーを管理します。

例:

```yaml
version: 1

apis:
  profiles:
    sales_orders_api:
      base_url: "https://api.example.com/orders"
      timeout_sec: 30

web:
  allowlist:
    - domain: "fonts.google.com"
      path_prefixes:
        - "/icons"
```

### `config/rename.csv`

RENAME リストから列名を一括変更するためのサンプル CSV です。

### `config/recent_flows.json`

最近使ったファイルのローカル履歴です。  
ローカル運用前提のファイルです。

## 保存形式

- データフロー: `.zizd`

## 主なショートカット

- `Ctrl+S`
  - 保存
- `Ctrl+Enter`
  - 実行

## 依存ライブラリ

Python 依存は [requirements.txt](requirements.txt) を参照してください。  
外部ライブラリと JS ベンダーの簡易一覧は [THIRD_PARTY_INVENTORY.md](THIRD_PARTY_INVENTORY.md) にまとめています。

## ライセンス補足

このプロジェクトは `PySide6` を利用しています。  
`PySide6` は Qt for Python として LGPL 系ライセンスで提供されています。  
実際の配布形態では、同梱方法とライセンス条件を別途確認してください。

CodeMirror 5.65.16 
ReDoS は Regular Expression Denial of Service です。
正規表現の処理に時間がかかりすぎて、アプリが極端に重くなったり止まったりする問題があるバージョン


logistroを利用
マイナーなため、情報少なめ。後でライブラリ変更するかも


MouseInfo
GPLv3+ だからです。MIT/BSD/Apache 系と違って、再配布や組み込み配布のときに条件が重くなります。

orjson です。
危険という意味ではなく、ライセンス構成が単純ではないため、社内台帳には「MIT」だけでなく MPL-2.0 AND (Apache-2.0 OR MIT) と正確に書いておく方がよいです。
