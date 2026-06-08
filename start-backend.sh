#!/bin/bash
set -e

cd "$(dirname "$0")"
PROJECT_ROOT=$(pwd)

check_port() {
    local port=$1
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null) || true
    if [ -n "$pids" ]; then
        echo "端口 $port 已被以下进程占用:"
        echo "$pids" | while read -r pid; do
            echo "  PID=$pid $(ps -p "$pid" -o comm= 2>/dev/null || echo '')"
        done
        echo -n "是否杀掉所有进程并继续？(y/n): "
        read -r answer
        if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
            echo "$pids" | while read -r pid; do
                kill -9 "$pid" 2>/dev/null
            done
            sleep 1
            echo "已释放端口 $port"
        else
            echo "请手动释放端口 $port 后重试"
            exit 1
        fi
    fi
}

check_port 8000

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    .venv/bin/pip install -e ".[dev]" -q
fi
source .venv/bin/activate

echo "Starting quant-lab backend..."
uvicorn quant_lab.main:app --reload --host 0.0.0.0 --port 8000
