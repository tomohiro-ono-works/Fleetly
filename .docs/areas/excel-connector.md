# excel-connector

## 役割

この文書は、Excel connector の責務範囲仕様である。

## 責務

- Excel ファイルの読み込み、書き込み、schema 適用を担当する。
- flow 実行時の `read_excel` / `write_excel` を提供する。
- Excel の sheet 名、header 行、data start 行、schema を connector 入力として扱う。
- connector は実行処理を担当し、GUI 上のファイル選択や preview 表示は直接担当しない。

## GUI Preview との関係

- Excel アシスタントのファイル選択、hidden 参照解決、UI 表示制御は bridge API の責務である。
- Excel ファイル形式の読み取り、sheet 一覧取得、先頭行 preview 用データ取得は Excel connector の責務である。
- `preview.readExcel` は bridge 側でパスを解決した後、Excel connector の preview API を呼び出す。
- `.xlsx` の preview は workbook XML と worksheet XML をストリームで読み、表示に必要な先頭行だけ取得する。
- `.xlsx` preview は既定で先頭 30 行を取得し、全行読み込みや pandas/openpyxl による workbook 全体解析に依存しない。
- `.xls` は Excel 97-2003 の旧バイナリ形式のため、高速 preview の対象外とする。必要になった場合は別方式として検討する。
- GUI preview の timeout、OS ダイアログ待機、`preview.readExcel` の扱いは `.docs/areas/gui-bridge.md` を参照する。
- flow 実行時の `read_excel` / `write_excel` は従来どおり connector が担当する。

## エラー方針

- 指定された sheet が存在しない場合は、sheet 不一致として明示的にエラーにする。
- ファイルが存在しない場合は、ファイル不在として明示的にエラーにする。
- preview 用の一時的な UI エラーと、flow 実行時の connector エラーを混同しない。

## パフォーマンス方針

- `read_excel` は `chunk_size` を connector 入力として扱う。
- `chunk_size` 未指定時または空指定時は 50,000 行ごとに読み込む。
- `chunk_size` は 1 以上で指定する。全件相当で読みたい場合は、想定行数以上の値を指定して 1 分割にする。
- `read_excel` は openpyxl の read-only row stream で読み、chunk ごとの進捗を実行ログへ記録する。
- `date_cleansing: false` の場合、Excel シリアル日付補完を行わないため、追加の workbook 再オープンによる epoch 取得は省略する。
- 大きい Excel の遅延は、openpyxl read-only 読み込み、connector 後処理、GUI 反映を分けてログで確認する。
