---
name: skill-creator
description: 新しいCodex Skillを追加したい/Skillの雛形を作りたい/skills配下に何を置くべきか迷ったときに使う。SKILL.mdのテンプレ生成、命名規則、トリガー条件の書き方、テスト手順まで案内する。
---

# Skill: Skill Creator（スキルを作るスキル）

## 目的
- 新しいSkillを `.codex/skills/<skill-name>/` に追加するための手順を標準化する
- `name` / `description` の書き方（= トリガー条件）を明確化し、呼び出し精度を上げる
- “最小構成で動く” 雛形を毎回同じ品質で作る

## ルール（必須）
- 1 Skill = 1 ディレクトリ
- ディレクトリ内に `SKILL.md` を **ちょうど1つ** 置く（skill.md/SKILL.md は大小区別なし）
- `SKILL.md` の先頭に YAML front matter を置き、`name` と `description` を必ず入れる
- `description` は「いつ使うか」を1〜2文で具体に書く（曖昧語だけにしない）

## 命名規則（推奨）
- `<skill-name>` は kebab-case（例: `pr-review`, `release-notes`, `duckdb-etl`）
- “対象+動詞” で短く（例: `sql-review`, `ppt-export`）
- 既存スキルと衝突しない名前にする

## 作成手順（標準）
1. `.codex/skills/<skill-name>/` を作る
2. `<skill-name>/SKILL.md` を作り、以下テンプレを埋める
3. （任意）`scripts/` `references/` `assets/` を追加する
4. VS Code のワークスペースをプロジェクトルートにして、Codex から新Skillを呼び出して動作確認する

## SKILL.md テンプレ（最小）
---  
name: <skill-name>  
description: <いつ使うか/何をするか（具体）>  
---

# Skill: <title>

## いつ使うか
- 箇条書きで2〜5個

## 入力
- 入力の形式、前提

## 手順
1. …
2. …

## 出力
- 成果物、保存先、確認方法

## 注意点
- 失敗しやすい点、禁則

## テスト手順（推奨）
- 「この依頼文ならこのSkillが呼ばれる」を3例書く
- 「呼ばれないほうが良い例」を2例書く（誤爆防止）