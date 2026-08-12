# Vector Connector

## 目的

- ローカル環境で、テキストを Ruri の埋め込みベクトルへ変換し、類似検索できるようにする。
- ベクトル検索は FAISS、ベクトルレコードとコレクション設定の永続化は DuckDB が担当する。
- connector は外部 I/O と変換のみを担当し、実行順序は workflow engine に委ねる。

## 用語

- コレクション: 同一の埋め込みモデル・類似度設定で検索するベクトルレコードの集合。
- ベクトルレコード: `id`、`vector`、`metadata`、必要に応じて元テキストを持つコレクション内の1件。

## 初期版の保存形式

- コレクションごとに `<collection_name>.faiss` と `<collection_name>.duckdb` を指定フォルダへ保存する。
- FAISS index は正規化済みベクトルの内積（cosine similarity 相当）で検索する。
- DuckDB の `vector_records` には `id`、FAISS 内部 ID、元テキスト、JSON化した metadata、更新日時を保存する。
- DuckDB の `collection_settings` には埋め込みモデル名とベクトル次元数を保存する。既存コレクションへ異なるモデルを登録・検索することはできない。

## Action 契約

### `embedding_vector_db`

- DataFrame を入力し、`id_column` と `text_column` の値からベクトルレコードを登録または更新する。
- 同一 ID の既存レコードは置換する。DataFrame の残りの列は metadata として保存する。
- 入力: `db_folder`、`collection_name`、`input_data`、`id_column`、`text_column`、任意の `model_name`。
- 出力: 登録件数、コレクション名、保存先、モデル名、ベクトル次元数を1行 DataFrame で返す。

### `search_vector_db`

- `query_text` をベクトル化し、近いベクトルレコードを返す。
- 入力: `db_folder`、`collection_name`、`query_text`、`top_k`、任意の `include_vector`・`model_name`。
- `include_vector` は既定で `false`。`true` の場合、既存のFAISS索引から復元したベクトル配列をJSON文字列の `vector` 列へ含める。文書ベクトルの再生成は行わない。
- 出力: `id`、`text`、`score`、JSON文字列の `metadata`、`collection_name`、必要に応じて `vector` を持つ DataFrame を返す。

## 依存関係

- PyTorch（CPU版）、`sentence-transformers`、`faiss-cpu` を使用する。
- 既存の `duckdb` と `pandas` を使用する。Ruri モデルの初回実行時はモデルファイルを取得する。
- 既定のモデル名は `cl-nagoya/ruri-v3-30m` とし、action パラメータで上書き可能にする。

## 初期版の範囲外

- ファイル形式ごとのテキスト抽出・チャンク分割
- metadata による検索フィルタ
- レコード単位の削除、コレクション一覧・削除、複数プロセスによる同時更新
