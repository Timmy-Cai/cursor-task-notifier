#!/bin/bash
# Cursor Agent 任务完成通知 v3
# 功能：提示音 + 语音（含项目名）+ 右上角推送（含项目名/任务名/点击跳回）+ 本地日志

input=$(cat)

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

# ── 提取关键字段 ─────────────────────────────────────────────
read -r conversation_id transcript_path workspace_root <<< $(echo "$input" | python3 -c "
import json, sys, os
d = json.load(sys.stdin)
cid = d.get('conversation_id', '')
tp  = d.get('transcript_path', '')
roots = d.get('workspace_roots', [])
root = os.path.basename(roots[0]) if roots else ''
print(cid, tp, root)
" 2>/dev/null)

# ── 去重：同一 conversation_id 60 秒内只通知一次 ──────────────
LOCK_FILE="/tmp/cursor-notify-${conversation_id}.lock"
if [[ -f "$LOCK_FILE" ]]; then
    exit 0
fi
touch "$LOCK_FILE"
(sleep 60 && rm -f "$LOCK_FILE") &

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

# ── Cursor 在前台则静默退出，不在前台则通知 ─────────────────
frontmost_app=$(lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | sed -n 's/.*"LSDisplayName"="\([^"]*\)".*/\1/p')
if [[ "$frontmost_app" == "Cursor" ]]; then
    exit 0
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
    # -execute 用 AppleScript 激活 Cursor，确保最小化窗口也能弹出
    /opt/homebrew/bin/terminal-notifier \
      -title "$notify_title" \
      -message "$notify_message" \
      -group "$conversation_id" \
      -execute "$HOME/.cursor/hooks/raise-cursor" &
fi

wait

# ── 写入本地完成日志（错过通知也能回溯）────────────────────
log_file="$HOME/.cursor/task-done.log"
timestamp=$(date '+%Y-%m-%d %H:%M:%S')
echo "[${timestamp}] ${project} | ${notify_message}" >> "$log_file"

exit 0
