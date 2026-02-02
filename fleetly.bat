@echo off
setlocal

:: バッチファイルのあるディレクトリへ移動
cd /d %~dp0

:: 1. 仮想環境の有効化
call venv_fleetly\Scripts\activate

:: 2. Python実行と色付け処理
python main.py "%~1"

:: 3. 仮想環境の無効化
call deactivate

pause
