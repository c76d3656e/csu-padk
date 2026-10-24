#!/usr/bin/env sh
# 平安打卡 · Linux 启动脚本
#
#   chmod +x start.sh
#   ./start.sh                # 0.0.0.0:5173
#   PORT=8080 ./start.sh      # 换端口
#   HOST=127.0.0.1 ./start.sh # 只给本机用
#
# 配套的 padk-linux-x64 是 musl 静态链接，不挑 glibc、不依赖任何 .so，
# 放同一目录即可。前端资源已经编进二进制，不需要 dist/。
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DIR"

BIN=${BIN:-./padk-linux-x64}
if [ ! -f "$BIN" ]; then
  echo "找不到 ${BIN}" >&2
  echo "把 padk-linux-x64 放到本脚本同一目录，或用 BIN=/path/to/padk ./start.sh 指定" >&2
  exit 1
fi
[ -x "$BIN" ] || chmod +x "$BIN" 2>/dev/null || true

PORT=${PORT:-5173}
HOST=${HOST:-0.0.0.0}
export PORT HOST

exec "$BIN"
