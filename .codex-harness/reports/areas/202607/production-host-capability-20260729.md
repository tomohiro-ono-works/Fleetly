# Production Host Capability Implementation Report

## Result

Task 020を完了した。

Windows GUI固有操作、Google認証helper、Excel／CSV previewを
`BridgeRuntime`の直接実装からapplication serviceへ分離した。
QWebChannel command名とrequest payloadは変更していない。

## Responsibility

- `HostCapabilityService`
  - file／folder／document open／save dialog
  - workspace root dialog
  - window control
  - coordinate capture
  - external browser open
- `GoogleAuthService`
  - 固定`gcloud auth application-default login`
  - account／ADC状態確認
- `PreviewService`
  - Excel preview
  - CSV preview

`WorkspaceService`はhost callbackを所有せず、選択済みrootの検証と状態管理だけを
担当する。`BridgeRuntime` handlerはhidden ref解決とservice dispatchに限定した。

## Thread And Security

- host callbackはservice生成threadをGUI所有threadとして検証する。
- GUI thread外のhost callback呼出しは`E_NOT_READY`にする。
- `app.openExternal`は`external_open` capability不足をhandler前に拒否する。
- `app.googleAuthStatus`とpreview commandはbackground workerで実行する。
- external URLは認証情報を含まないHTTP／HTTPSだけを許可する。

## Auth Contract

`app.googleAuthLogin` responseを正本どおり
`launched + provider + mode`へ統一し、実行command文字列を返さない。
ADC確認ではaccess token標準出力を破棄し、token本体をresponse、log、
service stateへ保持しない。

## Preview Contract

- 表示preview: 最大30行
- schema判定用行: 最大100行
- CSV encoding／delimiterをservice側でも検証
- responseにはhidden ref metadataとfile名を返し、実pathを追加しない

## Verification

- host／auth／preview／QWebChannel focused test: 39件成功
- Python全体: 127件成功、2件skip
- `py_compile`: 成功

frontend UIは変更していないため、Task 020固有のPlaywright追加は行っていない。

## Next

Phase 11として、production経路から外れた旧bridge／frontend責務を
利用確認付きで物理削除する。
