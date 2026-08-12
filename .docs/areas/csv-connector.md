# csv-connector

## 役割

この文書は、CSV connector の責務範囲仕様である。

## 責務

- CSV/TSV/テキスト区切りファイルの読み込み、書き込み、schema 適用を担当する。
- flow 実行時の `read_csv` / `write_csv` を提供する。
- CSV の encoding、delimiter、header 行、data start 行、schema を connector 入力として扱う。

## パフォーマンス方針

- `read_csv` は `chunk_size` を connector 入力として扱う。
- `chunk_size` 未指定時は 50,000 行ごとに読み込む。`0` または空指定時は従来どおり全件読み込みにする。
- 分割読み込み時は pandas の `read_csv(chunksize=...)` を使い、chunk ごとの進捗を実行ログへ記録する。
