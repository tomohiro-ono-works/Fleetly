# YAML Task Manager (最新版 / file://対応)

この版は **ES Modules(import/export)を使わず**、`file://` で開いても動くようにしています。

## 使い方
1. `index.html` を Chrome で開く
2. `sample/tasks.yaml` をインポート
3. 編集後、YAMLをダウンロード

## 依存
CDN:
- js-yaml
- frappe-gantt
- SortableJS

CDNがブロックされる環境では、これらを同梱して参照先を差し替える必要があります。
