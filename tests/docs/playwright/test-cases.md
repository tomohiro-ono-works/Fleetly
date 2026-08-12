# Playwright テストケース

## 前提

- テスト対象は browser-only の `static/home.html`
- bridge 未接続を前提とする
- native アプリ / WebView 外 / Qt ネイティブダイアログは対象外とする
- 根拠要件は主に以下
  - [01_アプリ初期化・共通レイアウト.md](/c:/Users/tomoh/Documents/Sandbox/zizai/docs/areas/static/tobe-components/01_%E3%82%A2%E3%83%97%E3%83%AA%E5%88%9D%E6%9C%9F%E5%8C%96%E3%83%BB%E5%85%B1%E9%80%9A%E3%83%AC%E3%82%A4%E3%82%A2%E3%82%A6%E3%83%88.md)
  - [02_ヘッダー（フロー名・保存・インポート）.md](/c:/Users/tomoh/Documents/Sandbox/zizai/docs/areas/static/tobe-components/02_%E3%83%98%E3%83%83%E3%83%80%E3%83%BC%EF%BC%88%E3%83%95%E3%83%AD%E3%83%BC%E5%90%8D%E3%83%BB%E4%BF%9D%E5%AD%98%E3%83%BB%E3%82%A4%E3%83%B3%E3%83%9D%E3%83%BC%E3%83%88%EF%BC%89.md)
  - [04_ノード詳細パネル（コネクタ・フォーム編集）.md](/c:/Users/tomoh/Documents/Sandbox/zizai/docs/areas/static/tobe-components/04_%E3%83%8E%E3%83%BC%E3%83%89%E8%A9%B3%E7%B4%B0%E3%83%91%E3%83%8D%E3%83%AB%EF%BC%88%E3%82%B3%E3%83%8D%E3%82%AF%E3%82%BF%E3%83%BB%E3%83%95%E3%82%A9%E3%83%BC%E3%83%A0%E7%B7%A8%E9%9B%86%EF%BC%89.md)

## このセットで確認する責務範囲

- トップ画面の初期表示
- サイドバーからの page 切替
- ホーム復帰後の再遷移
- browser-only 時の保存バリデーション
- browser-only 時の診断ダイアログ
- browser-only 時のデータタブ fallback

## 今回の対象外

- PySide6 / Qt WebEngine 自体の起動成否
- `QFileDialog` などネイティブダイアログ
- `flow.load / flow.save / flow.run` の bridge 実通信
- WebView hardening の実効確認
- Excel / CSV プレビューの Python bridge 実行
- 実 connector 実行結果

## ケース一覧

### TC-UI-001 トップ画面の基本表示

- 目的
  - 起動直後にトップ画面が表示されること
- 観点
  - `最近使ったファイル`
  - `テンプレートから作成する`
  - bridge 未接続時の空表示
- 期待結果
  - 2 セクションが見える
  - `ファイルがありません。` が 2 件見える
  - サイドバー左上アイコン押下前はトップ画面が既定表示である

### TC-UI-002 トップ画面からデータフロー画面への遷移

- 目的
  - サイドバーでトップ画面を閉じて編集画面へ遷移できること
- 観点
  - home DOM が消える
  - canvas が表示される
  - detail panel が表示される
  - フロー名が mode 既定値へ切り替わる
- 期待結果
  - `データフロー１`
  - `canvas.flow-canvas`
  - `#nodeDetail .detail-node`

### TC-UI-003 ホーム復帰後の再遷移

- 目的
  - トップ画面へ戻ったあともフローチャートが正しく再生成されること
- 観点
  - アイコンでホームへ戻る
  - 再度サイドバー遷移
- 期待結果
  - トップ画面が消える
  - workflow の canvas が再表示される
  - フロー名が `ワークフロー１`

### TC-UI-004 診断ボタンの browser-only エラー表示

- 目的
  - bridge 未接続時の診断失敗を共通ダイアログで明示できること
- 観点
  - カスタムダイアログ
  - タイトル
  - 失敗メッセージ
- 期待結果
  - `診断`
  - `診断情報を取得できませんでした。`

### TC-UI-005 保存ボタンの未入力チェック

- 目的
  - 未入力のまま保存した場合、共通ダイアログで警告できること
- 観点
  - 必須パラメータ未入力
- 期待結果
  - `入力確認`
  - `必須パラメータが未入力です。`

### TC-UI-006 データタブの browser-only fallback

- 目的
  - bridge 未接続時にデータタブが WebView 専用案内を表示すること
- 観点
  - データコネクタ画面
  - データタブ
- 期待結果
  - `WebView モードでのみ利用できます。`

## 抜け漏れ確認メモ

- 要件 01 の「最近使ったファイルの日時表示」は browser-only でも検証可能だが、fixture を用意していないため今回の自動テスト対象外
- 要件 02 の「診断ボタン配置ずれ」は DOM/CSS の見た目確認項目であり、現行テストセットでは未対象
- 要件 04 の `スキーマ / データ / サマリ` 切替は、前提としてフローチャート描画が成功する必要があるため、まず TC-UI-002/003 の安定化を優先する
