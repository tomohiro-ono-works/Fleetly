@echo off
setlocal
cd /d %~dp0..
set "PYTHON_EXE=.env\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo Python virtual environment not found: %PYTHON_EXE%
    echo Create it or install dependencies before running ziz.
    exit /b 1
)

"%PYTHON_EXE%" zizai.py %*
