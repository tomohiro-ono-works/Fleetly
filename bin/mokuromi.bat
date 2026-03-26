@echo off
setlocal

cd /d "%~dp0"
cd ..

call "venv_mokuromi\Scripts\activate"
python mokuromi.py