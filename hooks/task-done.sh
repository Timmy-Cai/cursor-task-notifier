#!/bin/bash
# Cursor Agent 任务完成通知 v4
# 功能：提示音 + 语音（含项目名）+ 右上角推送（含项目名/任务名/点击跳回）+ 本地日志
# 测试模式：环境变量 CURSOR_NOTIFIER_TEST=1 跳过前台检测 + 跳过 conversation 去重，
#           用于扩展首次安装时演示通知 / 触发 macOS 通知权限授权。

input=$(cat 2>/dev/null || echo '{}')

# 调试：记录原始 JSON（排查问题用，稳定后可删）
echo "$input" > /tmp/cursor-hook-debug.json

# ── 加载配置文件 ──────────────────────────────────────────────
CONF_FILE="$(dirname "$0")/task-done.conf"
NOTIFY_ENABLED=true
NOTIFY_SOUND=true
NOTIFY_SOUND_FILE=/System/Library/Sounds/Glass.aiff
NOTIFY_VOICE=true
NOTIFY_VOICE_NAME=Meijia
NOTIFY_BANNER=true
[[ -f "$CONF_FILE" ]] && source "$CONF_FILE"

# 总开关
[[ "$NOTIFY_ENABLED" != "true" ]] && exit 0

# ── 定位 terminal-notifier（兼容 Apple Silicon / Intel / 自定义 PATH）
TERMINAL_NOTIFIER=""
for p in /opt/homebrew/bin/terminal-notifier /usr/local/bin/terminal-notifier; do
    [[ -x "$p" ]] && TERMINAL_NOTIFIER="$p" && break
done
if [[ -z "$TERMINAL_NOTIFIER" ]]; then
    TERMINAL_NOTIFIER="$(command -v terminal-notifier 2>/dev/null)"
fi

# raise-cursor 可执行文件路径（点击横幅跳回 Cursor）
RAISE_CURSOR="$(dirname "$0")/raise-cursor"

# ── 提取关键字段 ─────────────────────────────────────────────
read -r conversation_id transcript_path workspace_root <<< $(echo "$input" | python3 -c "
import json, sys, os
d = json.load(sys.stdin)
cid = d.get('conversation_id', '') or ''
tp  = d.get('transcript_path', '') or ''
roots = d.get('workspace_roots', []) or []
root = os.path.basename(roots[0]) if roots else ''
# 空值用占位符，保证 read 能正确切列
print(cid or '-', tp or '-', root or '-')
" 2>/dev/null)

# 恢复空值
[[ "$conversation_id" == "-" ]] && conversation_id=""
[[ "$transcript_path" == "-" ]] && transcript_path=""
[[ "$workspace_root" == "-" ]] && workspace_root=""

# ── 去重：同一 conversation_id 60 秒内只通知一次 ──────────────
# 修复：conversation_id 为空时使用进程级时间戳，避免所有通知共用同一个 lock 导致永久静默
if [[ -n "$conversation_id" ]]; then
    LOCK_KEY="$conversation_id"
else
    # 无 conversation_id 时，用当前分钟级时间戳做去重（同一分钟内同项目只通知一次）
    LOCK_KEY="anon-${workspace_root}-$(date '+%Y%m%d%H%M')"
fi
LOCK_FILE="/tmp/cursor-notify-${LOCK_KEY}.lock"
if [[ "$CURSOR_NOTIFIER_TEST" != "1" ]]; then
    if [[ -f "$LOCK_FILE" ]]; then
        exit 0
    fi
    touch "$LOCK_FILE"
    (sleep 60 && rm -f "$LOCK_FILE") &
fi

# 从 transcript 提取最后一条用户指令（去掉 XML 标签，截取前 40 字）
task_name=$(python3 -c "
import json, re, sys
path = sys.argv[1]
if not path:
    sys.exit(0)
try:
    last = ''
    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
                if d.get('role') == 'user':
                    content = d.get('message', {}).get('content', [])
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            text = re.sub(r'<[^>]+>', '', item.get('text', '')).strip()
                            if text:
                                last = text
            except:
                pass
    print(last[:40])
except:
    pass
" "$transcript_path" 2>/dev/null)

# ── Cursor 在前台则静默退出，不在前台则通知（测试模式跳过）──
if [[ "$CURSOR_NOTIFIER_TEST" != "1" ]]; then
    frontmost_app=$(lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | sed -n 's/.*"LSDisplayName"="\([^"]*\)".*/\1/p')
    if [[ "$frontmost_app" == "Cursor" ]]; then
        exit 0
    fi
fi

# ── 组装通知文本 ──────────────────────────────────────────────
project="${workspace_root:-Cursor}"
notify_title="✅ ${project} · 任务完成"
notify_message="${task_name:-任务已完成，请查看结果}"

# ── 提示音、语音、横幅同时并发触发 ──────────────────────────
if [[ "$NOTIFY_SOUND" == "true" ]]; then
    afplay "${NOTIFY_SOUND_FILE:-/System/Library/Sounds/Glass.aiff}" &
fi

if [[ "$NOTIFY_VOICE" == "true" ]]; then
    speech_text="${project} 项目任务完成，请查看结果。"
    voice="${NOTIFY_VOICE_NAME:-Meijia}"
    if say -v "$voice" "" 2>/dev/null; then
        say -v "$voice" -r 175 "$speech_text" &
    else
        say -v "Samantha" -r 175 "${project} task complete. Please check the result." &
    fi
fi

if [[ "$NOTIFY_BANNER" == "true" ]]; then
    # 通道选择策略：
    #   1) terminal-notifier（若已安装）：支持「点击横幅跳回 Cursor」+ 同会话合并去重
    #   2) osascript（系统自带）：零依赖，支持横幅 + 通知中心，不支持点击跳回
    # 首次使用 osascript 时 macOS 会弹「脚本编辑器」通知权限申请，点允许即可
    if [[ -n "$TERMINAL_NOTIFIER" && -x "$TERMINAL_NOTIFIER" ]]; then
        group_id="${conversation_id:-$LOCK_KEY}"
        notifier_args=(
            -title "$notify_title"
            -message "$notify_message"
            -group "$group_id"
        )
        if [[ -x "$RAISE_CURSOR" ]]; then
            notifier_args+=(-execute "$RAISE_CURSOR")
        fi
        "$TERMINAL_NOTIFIER" "${notifier_args[@]}" &
    else
        # 转义双引号，防止标题/消息里出现 " 时 AppleScript 解析失败
        _t="${notify_title//\"/\\\"}"
        _m="${notify_message//\"/\\\"}"
        _s="Cursor Task Notifier"
        osascript -e "display notification \"${_m}\" with title \"${_t}\" subtitle \"${_s}\"" &
    fi
fi

wait

# ── 写入本地完成日志（错过通知也能回溯）────────────────────
log_file="$HOME/.cursor/task-done.log"
timestamp=$(date '+%Y-%m-%d %H:%M:%S')
echo "[${timestamp}] ${project} | ${notify_message}" >> "$log_file"

exit 0
