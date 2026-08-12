# Task 020: production host capability

## 状態

完了

## 目的

Windows GUI固有のdialog、window、coordinate、external open、Google authと、
Excel／CSV previewを`BridgeRuntime`の直接実装からapplication serviceへ移す。
QWebChannel command名とpayloadを維持し、host操作だけをGUI threadに限定する。

## 対象

- `HostCapabilityService`
  - file／folder／document open／save dialog
  - workspace root dialog
  - window control
  - coordinate capture
  - external browser open
- `GoogleAuthService`
  - BigQuery向け固定gcloud login
  - account／ADC status
- `PreviewService`
  - Excel preview
  - CSV preview
- `BridgeRuntime` handlerを上記serviceへの委譲へ変更
- host capabilityのbackend security validation
- `app.googleAuthStatus`のbackground dispatch
- Windows GUI hostから必要callbackを注入

## 契約

- command名とrequest payloadは変更しない。
- `app.googleAuthLogin` responseは正本仕様どおり
  `launched + provider + mode`とし、実行command文字列を返さない。
- access tokenはresponse、通常log、service stateへ保持しない。
- host capability不足とGUI thread外呼出しは`E_NOT_READY`にする。
- previewの行上限は表示30行、schema判定100行を維持する。

## 対象外

- macOS／Linux host対応
- frontend UI変更
- 旧bridge handler全体の物理分割／削除
- PySide host全体の再構築
- standalone実行UI

## 実装方針

1. serviceはQWebChannel、QObject、frontendを知らない。
2. Qt dialog／window／coordinateの実処理はhost callbackに残す。
3. host serviceは生成threadを所有threadとし、host callbackを別threadから呼ばない。
4. previewとauth statusはGUI threadをblockしない。
5. URL、mode、encoding、delimiterはservice側でも再検証する。
6. 旧handlerへのfallbackや二重実装を残さない。

## 完了条件

- host commandが`BridgeRuntime`内で直接OS／Qt処理を実装しない。
- capability不足をhandler実行前に拒否する。
- GUI thread外のhost callback実行を拒否する。
- Google auth response／logにcommand、token、credentialを含めない。
- Excel／CSV previewの上限とresponse contractが維持される。
- Python全体とQWebChannel／host focused testが成功する。

## 検証結果

- focused test: 39件成功
- Python全体: 127件成功、2件skip
- `py_compile`: 成功
