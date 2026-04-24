#!/bin/bash
# Cursor Task Notifier — 一键安装脚本
# 支持：macOS + Cursor IDE
# 用法：bash install.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# 脚本所在目录（支持从任意路径调用）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BOLD}=================================================="
echo -e "  Cursor Task Notifier — 一键安装"
echo -e "==================================================${NC}"
echo ""

# ── Step 1: 系统检查 ────────────────────────────────────────
info "检查运行环境..."

[[ "$(uname)" != "Darwin" ]] && error "仅支持 macOS"

if ! command -v brew &>/dev/null; then
    error "未找到 Homebrew，请先安装：https://brew.sh"
fi
success "Homebrew ✓"

if ! command -v python3 &>/dev/null; then
    error "未找到 python3，请先安装 Python3"
fi
success "python3 ✓"

# ── Step 2: 安装 terminal-notifier ─────────────────────────
if ! command -v terminal-notifier &>/dev/null; then
    info "安装 terminal-notifier..."
    brew install terminal-notifier
fi
success "terminal-notifier ✓"

# ── Step 3: 创建目录 ────────────────────────────────────────
info "创建目录..."
mkdir -p ~/.cursor/hooks ~/.cursor/rules
success "目录创建完成"

# ── Step 4: 复制 hook 脚本 ──────────────────────────────────
info "安装 hook 脚本..."
cp "$SCRIPT_DIR/hooks/task-done.sh" ~/.cursor/hooks/task-done.sh
chmod +x ~/.cursor/hooks/task-done.sh

# 仅在 conf 不存在时初始化（不覆盖用户已有配置）
if [[ ! -f ~/.cursor/hooks/task-done.conf ]]; then
    cp "$SCRIPT_DIR/hooks/task-done.conf.template" ~/.cursor/hooks/task-done.conf
    success "task-done.conf 初始化完成"
else
    warn "task-done.conf 已存在，跳过（保留你的配置）"
fi
success "hook 脚本安装完成"

# ── Step 5: 编译 raise-cursor（点击通知跳回 Cursor）─────────
info "编译 raise-cursor..."
if command -v swiftc &>/dev/null; then
    swiftc "$SCRIPT_DIR/hooks/raise-cursor.swift" -o ~/.cursor/hooks/raise-cursor 2>/dev/null && \
        success "raise-cursor 编译完成" || \
        warn "raise-cursor 编译失败（点击通知跳回功能不可用，其余功能正常）"
else
    warn "未找到 swiftc，跳过编译（需安装 Xcode Command Line Tools）"
fi

# ── Step 6: 注册 hooks.json（merge，不覆盖已有 hooks）───────
info "注册 Cursor Hook..."
HOOKS_FILE=~/.cursor/hooks.json
HOOK_ENTRY='{"command":"hooks/task-done.sh","timeout":15}'

if [[ -f "$HOOKS_FILE" ]]; then
    # 检查是否已注册
    if grep -q "task-done.sh" "$HOOKS_FILE" 2>/dev/null; then
        warn "hooks.json 已包含 task-done.sh，跳过"
    else
        # 用 python3 merge，保留已有 hooks
        python3 - "$HOOKS_FILE" "$HOOK_ENTRY" <<'PYEOF'
import json, sys
path = sys.argv[1]
new_entry = json.loads(sys.argv[2])
with open(path) as f:
    data = json.load(f)
data.setdefault("hooks", {}).setdefault("stop", []).append(new_entry)
with open(path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print("merged")
PYEOF
        success "hooks.json 已合并"
    fi
else
    cat > "$HOOKS_FILE" <<'EOF'
{
  "version": 1,
  "hooks": {
    "stop": [
      {
        "command": "hooks/task-done.sh",
        "timeout": 15
      }
    ]
  }
}
EOF
    success "hooks.json 创建完成"
fi

# ── Step 7: 安装 Cursor 扩展 ────────────────────────────────
info "安装 Cursor 扩展..."
VSIX=$(ls "$SCRIPT_DIR"/cursor-task-notifier-*.vsix 2>/dev/null | sort -V | tail -1)
CURSOR_CLI="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"

if [[ -f "$VSIX" ]] && [[ -f "$CURSOR_CLI" ]]; then
    "$CURSOR_CLI" --install-extension "$VSIX" 2>/dev/null && \
        success "Cursor 扩展安装完成" || \
        warn "扩展安装失败，请手动拖入 .vsix 文件"
elif [[ ! -f "$CURSOR_CLI" ]]; then
    warn "未找到 Cursor CLI，请手动安装扩展：Extensions → Install from VSIX → 选择 cursor-task-notifier-*.vsix"
else
    warn "未找到 .vsix 文件，请手动安装扩展"
fi

# ── 完成 ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}=================================================="
echo -e "  安装完成！"
echo -e "==================================================${NC}"
echo ""
echo -e "  ${BOLD}后续步骤：${NC}"
echo -e "  1. ${YELLOW}无需重启 Cursor${NC}：Cursor 会自动热加载 hooks.json，安装完即可让 Agent 跑任务"
echo -e "  2. ${YELLOW}开通通知权限${NC}：首次弹通知时 macOS 会申请权限，点「允许」即可"
echo -e "     （或提前去：系统设置 → 通知 → 脚本编辑器 / terminal-notifier → 横幅或提醒）"
echo -e "  3. 在 Cursor 设置页搜索 ${BOLD}cursorTaskNotifier${NC} 配置各项开关"
echo ""
echo -e "  ${BLUE}配置文件位置：${NC}~/.cursor/hooks/task-done.conf"
echo ""
