param(
  [Parameter(Mandatory=$true)][string]$Name,
  [string]$Description = "TODO: いつ使うか/何をするか"
)

$root = Join-Path (Get-Location) ".codex\skills\$Name"
New-Item -ItemType Directory -Force $root | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root "scripts") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root "references") | Out-Null

$skill = @"
---
name: $Name
description: $Description
---

# Skill: $Name

## いつ使うか
- TODO

## 入力
- TODO

## 手順
1. TODO

## 出力
- TODO

## 注意点
- TODO

## テスト手順
- 呼び出される例: TODO
- 呼び出されない例: TODO
"@

Set-Content -Encoding UTF8 (Join-Path $root "SKILL.md") $skill
Write-Host "Created: $root"