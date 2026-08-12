# Excel取り込みタスク

> この文書は旧実装で取得した性能調査の履歴である。記載する
> `logs/execution.log`は測定当時の根拠であり、202607現行実装では作成しない。
> 現行のlog分離は`.docs/areas/gui-bridge.md`と
> `.docs/future/qwebchannel/run-result-events.md`を正本とする。

## 目的

`workflows/excel_100k_sample200_benchmark.zizd` を GUI から実行した際に、実行時間が長く見える理由を確認する。

対象ファイル:

- flow: `workflows/excel_100k_sample200_benchmark.zizd`
- Excel: `workflows/ec_site_100k_300.xlsx`
- sheet: `sheet1`
- サイズ: 約 174 MB
- データ規模: 100,000 行 x 300 列

## 既存ログから分かること

| 区間 | 時間 | 根拠 |
| --- | ---: | --- |
| GUI実行全体 | 1169.66秒 / 約19分30秒 | `logs/execution.log` の `run.start` -> `run.finish` |
| headless実行 | 905.87秒 / 約15分06秒 | `ziz workflows/excel_100k_sample200_benchmark.zizd` |
| GUI上乗せ推定 | 263.79秒 / 約4分24秒 | GUI全体 - headless |

重要:

- 既存のGUIログには、`core実行完了`、`bridge返却`、`画面反映完了` の個別時刻がない。
- そのため、既存ログだけでは GUI 側の内訳は分解できない。
- GUI上乗せ約4分24秒は推定差分であり、内訳ではない。

## pandas / connector / headless の実測

| 取得方法 | 条件 | 時間 |
| --- | --- | ---: |
| pandas | 全件読込 | 約702.52秒 / 約11分43秒 |
| ExcelConnector単体 | flowと同じparams | 約771.85秒 / 約12分52秒 |
| headless | flow実行 | 約905.87秒 / 約15分06秒 |

その後、計測ログ追加後の headless 実測:

| 処理 | 時間 |
| --- | ---: |
| pandas/openpyxl Excel読込 | 713.07秒 / 約11分53秒 |
| connector normalize | 13.18秒 |
| Excel epoch lookup | 0秒、`date_cleansing=false` のためスキップ |
| schema適用 | 6.69秒 |
| connector.execute 全体 | 733.69秒 / 約12分14秒 |
| ui_cache作成 | 0.11秒 |
| headless全体 | 734.76秒 / 約12分15秒 |

## 現時点の結論

- headless側では、ほぼ `ExcelConnector.read_excel()` 内の `pd.read_excel(..., engine="openpyxl")` が支配的。
- `ui_cache` 作成は 0.1 秒程度で、headless上ではボトルネックではない。
- `date_cleansing=false` でも Excel epoch を再取得していた処理は不要だったため、省略する修正を入れた。
- GUI側で追加される約4分24秒の内訳は、既存ログでは不明。

## 追加した計測ログ

GUI内訳を次回確認できるよう、以下のログを追加済み。

Backend:

- `run.core.finish`
- `run.result.store`
- `run.terminal_event.emit`
- `run.ui`

Frontend:

- `run.gui.timeline`
- terminal event受信
- summary取得時間
- paint後の画面反映時間

Connector / core:

- `Excel pandas read`
- `Excel normalize`
- `Excel epoch lookup`
- `Excel schema apply`
- `connector.execute 完了`
- `ui_cache build 完了`

Structured events in `logs/execution.log`:

- `run.core.connector.start`
- `run.connector.library.finish` with `library=pandas/openpyxl`
- `run.connector.phase.finish` with `phase=normalize`
- `run.connector.phase.skipped` with `phase=epoch_lookup`
- `run.connector.phase.finish` with `phase=schema_apply`
- `run.core.connector.finish`
- `run.core.ui_cache.finish`

## 実装済み変更

- `connectors/excel_connector.py`
  - `date_cleansing=false` の場合、Excel epoch lookup をスキップ。
  - pandas読込、normalize、schema適用の段階ログを追加。

- `core/workflow_engine.py`
  - `connector.execute` と `ui_cache build` の時間ログを追加。

- `app/gui/bridge.py`
  - GUI実行で `core実行完了`、結果保存、terminal event送信を `logs/execution.log` に記録。

- `static/js/app.js`
  - terminal event受信後、summary取得、paint後の画面反映時間を `run.gui.timeline` として記録。

- `tests/python/test_excel_connector.py`
  - `date_cleansing=false` で epoch lookup しないことを確認。
  - `date_cleansing=true` では従来通り epoch lookup することを確認。

## 検証済み

| 検証 | 結果 |
| --- | --- |
| `python -m py_compile` | OK |
| `node --check static/js/app.js` | OK |
| `python -m unittest tests.python.test_excel_connector` | OK |
| `python -m unittest discover -s tests/python -p test_*.py` | 26件 OK |
| headless実行 | 約12分15秒で完了 |

## 未解決

GUI側の以下の内訳は、次回GUI実行後のログ確認が必要。

| 区間 | 状態 |
| --- | --- |
| core実行完了まで | 次回ログで確認 |
| bridge terminal event送信まで | 次回ログで確認 |
| frontend terminal event受信まで | 次回ログで確認 |
| summary取得まで | 次回ログで確認 |
| 画面反映完了まで | 次回ログで確認 |

## GUI実行ログ確認 2026-06-14

抽出結果:

- report: `.codex-harness/reports/areas/excel/gui-timeline-20260614-150552.md`
- run_id: `run_ab647da73885`
- status: success

| 区間 | 時間 |
| --- | ---: |
| GUI全体 `run.start` -> `run.finish` | 1072.90秒 / 約17分53秒 |
| core実行 `run.core.finish elapsed_ms` | 1072.89秒 / 約17分53秒 |
| result store | 0.0秒 |
| terminal event emit | core完了後ほぼ即時 |

このrunでは、GUI全体時間とcore実行時間がほぼ一致した。

未取得:

- `run.gui.timeline`
- frontend terminal event受信時間
- summary取得時間
- paint後の画面反映時間

解釈:

- backend側のbridge返却・結果保存は重くない。
- このrunの大半は core/connector 実行時間。
- frontend側の内訳は、`run.gui.timeline` が出ていないため未確定。

## GUI実行ログ確認 2026-06-14 追加計測

抽出結果:

- report: `.codex-harness/reports/areas/excel/gui-timeline-20260614-153753.md`
- run_id: `run_a53ec4112131`
- status: success

| 区分 | 処理 | 時間 |
| --- | --- | ---: |
| GUI全体 | `run.start` -> `run.finish` | 1275.61秒 / 約21分16秒 |
| core | `run.core.finish` | 1275.60秒 / 約21分16秒 |
| core -> connector | `run.core.connector.finish` | 1275.42秒 / 約21分15秒 |
| pandas/openpyxl | `run.connector.library.finish` / `read_excel` | 1243.19秒 / 約20分43秒 |
| connector | `normalize` | 18.31秒 |
| connector | `epoch_lookup` | 0.0秒、`date_cleansing=False` によりskip |
| connector | `schema_apply` | 12.92秒 |
| core | `ui_cache` | 0.17秒 |
| bridge/backend | `result.store` | 0.1秒 |
| bridge/backend | `terminal_event.emit` | core完了後ほぼ即時 |

結論:

- 今回のGUI実行では、重い箇所は `pandas/openpyxl` による Excel 読み込み。
- GUI/bridge/backend保存/coreのUI cacheは、今回のログ上では重くない。
- `run.gui.timeline` は未取得のため、frontendのsummary取得・paint後反映だけは未確定。

## 実施済み確認手順

以下は、GUI側の内訳確認のために実施した手順。

1. GUIアプリを再起動する。
2. `workflows/excel_100k_sample200_benchmark.zizd` をGUIから1回だけ実行する。
3. 以下のコマンドでGUI実行ログをMarkdownへ抽出する。

```powershell
.\.codex-harness\scripts\extract_excel_gui_timeline.bat
```

4. `logs/execution.log` から以下が抽出されていることを確認する。
   - `run.core.finish`
   - `run.core.connector.start`
   - `run.connector.library.finish`
   - `run.connector.phase.finish`
   - `run.connector.phase.skipped`
   - `run.core.connector.finish`
   - `run.core.ui_cache.finish`
   - `run.result.store`
   - `run.terminal_event.emit`
   - `run.ui` / `run.gui.timeline`
5. GUI上乗せ時間を、core処理、bridge、frontend反映に分けて整理する。

抽出結果に `Missing run.core.finish` / `Missing run.gui.timeline` が出る場合は、GUIアプリが計測ログ追加後のコードで再起動されていない、または対象flowをまだGUI実行していない。

特定の `run_id` を指定する場合:

```powershell
.\.codex-harness\scripts\extract_excel_gui_timeline.bat -RunId run_xxxxxxxxxxxx
```

出力先を指定する場合:

```powershell
.\.codex-harness\scripts\extract_excel_gui_timeline.bat -OutputPath .codex-harness\reports\areas\excel\gui-timeline-manual.md
```

## 追加調査タスク

GUIプロセス内の `pandas/openpyxl read_excel` が pandas単体より遅くなる理由を確認する。

| タスク | 確認観点 | 優先度 |
| --- | --- | --- |
| GUIプロセスのメモリ圧迫 | 実行前/実行中/実行後のRSS、メモリ使用量、スワップ発生有無 | 高 |
| Qt WebEngine と同居している影響 | GUI同一プロセス内実行と別プロセス実行の比較 | 高 |
| 既存GUI状態・DataFrame保持によるメモリ残り | 連続実行時に `latest_by_flow` / context / DataFrame保持が残るか | 高 |
| 32bit/64bitやPython実行環境差 | GUI起動PythonとCLI/単体pandasの `sys.executable` / `platform.architecture()` 比較 | 中 |
| ウイルス対策/ファイルロック/同時アクセス | Excelファイルへの同時アクセス、読み取り中のロック、AVスキャン影響 | 中 |

## メモリ圧迫調査 2026-06-14

抽出結果:

- report: `.codex-harness/reports/areas/excel/memory-pressure-20260614-1723.md`
- sample CSV: `.codex-harness/reports/areas/excel/memory-samples-live-20260614-170610.csv`
- run_id: `run_231fd7f11f76`
- status: success

| 区分 | 処理 | 時間 |
| --- | --- | ---: |
| GUI全体 | `run.start` -> `run.finish` | 966.39秒 / 約16分06秒 |
| pandas/openpyxl | `read_excel` | 942.02秒 / 約15分42秒 |
| connector | `normalize` | 13.96秒 |
| connector | `schema_apply` | 9.56秒 |
| core | `ui_cache` | 0.13秒 |

メインGUI Pythonプロセスのメモリ:

| 時点 | Private MB | Working Set MB | 空きRAM |
| --- | ---: | ---: | ---: |
| 計測開始付近 | 733.7 | 345.8 | 6.28 GB |
| ピーク | 3078.9 | 2591.2 | 5.39 GB |
| 完了後 | 1281.1 | 790.5 | 7.10 GB |

解釈:

- 今回の実測では、物理メモリ不足やスワップ発生を主因とする証拠はない。
- PythonプロセスはExcel読込中に約3.1GBまで増えたが、空きRAMは最小でも約5.39GB残っていた。
- 完了後にメモリは約1.28GBまで下がっており、巨大な一時メモリが残り続ける挙動も薄い。
- 16分から21分程度の実行時間差は、`openpyxl` による `.xlsx` パース時間の揺れとして扱う。

## クローズ判定 2026-06-14

この件は「調査クローズ」とする。

- GUI/bridge/backend保存/coreのUI cacheは主要因ではない。
- メモリ圧迫も今回の実測では主要因ではない。
- 主因は `pandas/openpyxl` による 100,000行 x 300列 `.xlsx` の読込コスト。
- 大容量Excelを毎回GUI実行で読む運用では、16分から21分程度かかることを既知制約として扱う。
- 改善する場合は、初回Excel読込後にCSV/Parquetへ変換して再利用するキャッシュ方式を第一候補とする。

## 反省点

- GUI側の内訳が必要だったにもかかわらず、既存ログで分解できないことを最初に明示できていなかった。
- pandas / connector / headless の全件実行を繰り返し、検証時間が長くなった。
- 次回以降は、10分以上かかる全件検証の前に目的と必要性を確認する。
