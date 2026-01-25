@echo off
setlocal

:: バッチファイルのあるディレクトリへ移動
cd /d %~dp0

:: 1. 仮想環境の有効化
call venv_fleetly\Scripts\activate

:: 2. Python実行と色付け処理
python main.py "%~1" 2>&1 | powershell -Command ^
    $esc = [char]27; ^
    $input ^| ForEach-Object { ^
        $line = $_; ^
        $line = $line -replace 'CRITICAL', \"$esc[38;2;255;66;0mCRITICAL$esc[0m\"; ^
        $line = $line -replace 'ERROR',    \"$esc[38;2;255;66;0mERROR$esc[0m\"; ^
        $line = $line -replace 'WARNING',  \"$esc[38;2;230;215;42mWARNING$esc[0m\"; ^
        $line = $line -replace 'DEBUG',    \"$esc[38;2;137;218;89mDEBUG$esc[0m\"; ^
        $line = $line -replace 'INFO',     \"$esc[38;2;137;218;89mINFO$esc[0m\"; ^
        Write-Output $line ^
    }

:: 3. 仮想環境の無効化
call deactivate

pause
