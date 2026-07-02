#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
cd "$SCRIPT_DIR/.."

PYTHON_EXE=".env/bin/python"

if [ ! -x "$PYTHON_EXE" ]; then
    echo "Python virtual environment not found: $PYTHON_EXE"
    echo "Create it or install dependencies before running ziz."
    exit 1
fi

exec "$PYTHON_EXE" zizai.py "$@"
