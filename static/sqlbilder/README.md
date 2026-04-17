# static/sqlbilder

このフォルダは `query-builder` モード専用の実装置き場です。

## 目的
- 共通 shell である `static/home.html` から分離して、SQLビルダー専用の UI と state をここへ集約する
- `header` と `sidebar` は共通のままにし、メインスペースだけを SQLビルダー専用実装に切り替える
- SQL 本体は `.sql` として保存し、`--@cte:` コメントで CTE 区切りを保持する
- UI 状態は保存しない
- 画面構成は
  - 左ペイン: カタログ / フローエディタ
  - 右メイン: 上段が左右 2 ペイン SQLエディタ、下段が実行結果
  - カタログは `データカタログ / SQLカタログ` の共有エリア
  - SQL タブは左右 2 ペインで独立管理する
  とする
 - 左右のペイン幅、左ペイン内の高さ、右メイン内の高さはスプリッターで変更できる

## 予定ファイル
- `sqlbilder.page.js`
  - SQLビルダー画面の entry
- `sqlbilder.state.js`
  - SQLビルダー専用 state
  - 左右ペインごとの SQL タブ配列と選択中タブを管理
  - 最後に触ったペインを管理
- `sqlbilder.layout.js`
  - 左ペイン 2 セクションと右メインを描画
  - 左右幅、左ペイン高さ、右メイン高さのスプリッターを管理
- `sqlbilder.flowlist.js`
  - 縦方向フロー図
  - 選択中 CTE の切替
  - DnD 並び替え
- `sqlbilder.catalog.data.js`
  - データカタログ UI
  - テーブル > カラム / 計算フィールド のツリー表示
- `sqlbilder.catalog.sql.js`
  - SQLカタログ UI
  - 固定の SQL スニペット一覧
- `sqlbilder.editor.js`
  - CTE エディタ補助
  - `--@cte:` ブロック編集
  - `CTE / 全文` 切替時の編集対象切替
  - 最後に触ったペインへの CTE 反映
- `sqlbilder.yaml.js`
  - SQLビルダー関連のシリアライズ補助
- `sqlbilder.css`
  - 専用スタイル

## 関連
- 要件定義:
  - `docs/standards/sqlbilder.md`
