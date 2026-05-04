# Suggest Index

- Path rule: `config/suggest_index/suggest_index_{ConnectorName}.yml`
- Matching: front match on `index` when `Tab` is pressed.
- Order: YAML記載順。
- `suggest_word`: string または string 配列（配列は非推奨）。
- `{{` の変数補完はこの辞書の対象外。

```yaml
entries:
  - index: sel
    suggest_word: |
      SELECT
      FROM
      WHERE

  - index: join
    suggest_word:
      - JOIN
      - LEFT JOIN
```
