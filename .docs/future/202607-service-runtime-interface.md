# 202607 Service / Runtime Internal Interface

202607版の実装・配布・動作保証はWindows PC版を対象とする。macOS／Linux向けのhost／process／path互換層は本interfaceの対象外とする。

## 位置づけ

この文書は、application serviceとruntime managerの内部IFについて、意味的契約を定義する。

関数名、引数名、型、default値の正確なシグネチャはPython実装を正本とし、この文書へ複製しない。unit testは実装が本契約を満たすことを検証する。

## 正本の分担

| 対象 | 正本 |
| --- | --- |
| 責務、入力／出力の意味、例外境界、同期性、state所有権、禁止事項 | 本文書 |
| 関数名、引数、型、default値 | `app/services/`、`app/runtime/`のPythonコード |
| IFの適合確認 | `tests/python/test_service_runtime_boundaries.py` |
| frontendとの言語間IF | `202607-qwebchannel-contract.md`、`qwebchannel/` |

## 境界

```text
GUI application service ─┐
                         ├─> RunService -> ExecutionManager
                         │               -> WorkflowExecutionService -> WorkflowEngine -> connector
                         │               -> StandaloneExecutionService -> connector
CLI ---------------------┘
```

- `WorkflowExecutionService`は1回のworkflow実行を担当する。
- `StandaloneExecutionService`はworkflowを作らない1回のconnector action実行を担当する。
- `RunService`はrun受付、worker、cancel、terminal確定、result／log／event連携を担当する。
- `ExecutionManager`は複数runにまたがるruntime state、競合制御、軽量run索引を担当する。
- GUIのQWebChannel transport、JSON envelope、response／event生成は担当しない。
- CLIはQWebChannelを経由せず、`WorkflowExecutionService`を直接利用する。

## 共通規則

- service／runtimeはPySide6、QWebChannel、WebView、frontend moduleをimportしない。
- 内部IFではPython objectを受け渡し、JSON messageへ変換しない。
- raw DataFrame、managed resource、contextをQWebChannel payloadへ載せない。
- DataFrame等の実行結果を内部境界の通過だけを理由にdeep copy、list化、dictionary化、serializeしない。
- application service errorはcodeとmessageを持つtransport非依存errorとし、bridge dispatcherがfailure responseへ変換する。
- secret mask、payload schema、security profileはbridge／application service境界で適用し、coreへfrontend payloadを直接渡さない。

## WorkflowExecutionService

### 操作

| 操作 | 意味 |
| --- | --- |
| file実行 | 保存済みflow fileを1回実行する。CLIが利用する |
| config実行 | parse済みdocument／configを1回実行する。GUIが利用する |

### 入力の意味

| 入力 | 契約 |
| --- | --- |
| flow file／config | 呼出元が選択・読込・validationした実行対象 |
| logger | 当該実行のlog出力先。serviceはfrontend eventへ直接変換しない |
| cancel event | callerが所有するcooperative cancellation token |
| initial context | step単独実行等で使用するruntime seed。serviceは保存正本にしない |
| requested step | 指定された場合だけ対象stepを実行する |
| status／performance callback | runtime通知用callback。QWebChannel envelopeを渡さない |
| step result callback | step完了直後のreport entryを通知する。表示用cacheの逐次格納に使用する |
| worker pool | GUI session全体のconnector処理数を制限するtransport非依存pool |

### 結果

- 実行reportと最終contextを1つのservice resultとして返す。
- reportはstatus、step report、error等の実行結果を表す。
- contextは後続stepや`gui-step-run` latest resultに使用するruntime objectを保持できる。
- report／contextをfrontendへ直接返さず、result serviceが上限付きsummary／schema／previewへ変換する。

### 例外境界

- workflow上の通常失敗は原則としてerror statusを持つreportで返す。
- service呼出し自体の不正や予期しない実装例外は握りつぶさずcallerへ伝播する。
- QWebChannel error codeへの変換はbridge dispatcherの責務とする。

### 同期性

- 1回のfile／config実行は同期処理であり、完了までcaller threadを占有する。
- GUIはexecution manager／workerから呼び、GUI threadで直接実行しない。
- CLIは同期呼出しを行い、終了statusをprocess exit codeへ変換する。

## ExecutionManager

### 所有するstate

| state | 意味 |
| --- | --- |
| run sessions | `run_id`ごとのstatus、cancel token、report、trace情報 |
| active workflow run | GUI session全体で現在実行中の①を引くindex |
| active standalone index | ②の実行元`doc_session_id`ごとのactive runを引くindex |
| latest workflow index | `doc_session_id + flow_id`ごとのactiveまたは最新runを引くindex |
| latest result | flow／step単独実行で使用するcontext、step result、UI cache、status |

state更新はmanager内部のlockで保護し、bridgeが同じ辞書へ独自の競合制御を追加しない。

### 操作の意味

| 操作 | 契約 |
| --- | --- |
| run登録 | ①はGUI session全体、②は実行元documentにactive runがあればconflict。成功時にsessionとindexを同時更新 |
| session取得 | 未指定はvalidation error、不存在はnot found |
| cancel要求 | active runのcancel tokenをsetし、受付結果を返す。terminal完了は保証しない |
| terminal更新 | status／終了時刻を更新し、対象runが現在のactive runである場合だけactive indexから外す |
| run索引取得 | summary／preview／log本体を含めず、documentごとのactive／latest identityとstatusを返す |
| latest更新 | 成功stepのresult／UI cacheと最終contextをflow単位で更新 |
| latest取得 | 最新成功resultがなければnot found。過去成功resultへfallbackしない |
| flow key移行 | 未保存documentの保存等で識別keyが変わった場合にlatest stateを移す |

### 不変条件

- ①workflow runはGUI session全体で最大1件とする。
- ②standalone runは実行元`doc_session_id`ごとに最大1件とする。
- `run_id`はsessionを一意に識別する。
- active indexとrun sessionは同じlock範囲で更新する。
- cancel受付とterminal状態を混同しない。
- result objectはruntime内部に保持し、bridgeへraw objectを返さない。
- managerはdocument保存、QWebChannel event送信、connector実行詳細を担当しない。

## RunService

### 所有する責務

- validation済みrequestのrun受付とID発行。
- workflow／standalone workerの開始。
- run log、step status、progress、terminal domain eventの通知。
- cancel受付とterminal確定の分離。
- workflow step完了直後の表示用result格納。
- terminal時のsummary、raw cache、resource cleanupの順序制御。

### 禁止事項

- QWebChannel envelopeを生成しない。
- frontend component名やDOM stateを持たない。
- `.zizd`保存、document tab操作、dialog表示を行わない。
- connector/action名でstandalone可否やdry run方式を判定せず、catalog metadataを使用する。

## IF変更ルール

- 意味、state所有権、例外境界、同期性を変える場合は、先に本書を更新する。
- 引数名、型、default値だけを変更する場合は、コードとunit testを同時に更新する。
- QWebChannel payloadへ影響する変更は内部IFだけで完結させず、`qwebchannel/`のcontractも更新する。
- 互換adapterや二重正本は追加しない。
