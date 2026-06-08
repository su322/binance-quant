#!/bin/bash
set -e

cd "$(dirname "$0")"

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

check_port 5173

if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm --prefix frontend install
fi

echo "Starting frontend (Vite)..."
npm --prefix frontend run dev
