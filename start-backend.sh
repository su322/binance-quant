#!/bin/bash
set -e

cd "$(dirname "$0")"
PROJECT_ROOT=$(pwd)

check_port() {
    local port=$1
    local pid
    pid=$(lsof -ti:"$port" 2>/dev/null) || true
    if [ -n "$pid" ]; then
        echo "端口 $port 已被进程 PID=$pid 占用"
        echo -n "是否杀掉该进程并继续？(y/n): "
        read -r answer
        if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
            kill -9 "$pid" 2>/dev/null
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
