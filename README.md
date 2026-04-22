# Cursor Task Notifier

Cursor Agent 任务完成后自动通知 — 提示音 + 语音播报 + 右上角横幅推送，Cursor 在前台时静默不打扰。

## 安装

```bash
git clone https://github.com/YOUR_USERNAME/cursor-task-notifier.git
cd cursor-task-notifier
bash install.sh
```

安装完成后：
1. **重启 Cursor**
2. 系统设置 → 通知 → `terminal-notifier` → 改为「横幅」或「提醒」
3. Cursor 设置页搜索 `cursorTaskNotifier` 配置各项开关

## 功能

| 功能 | 说明 |
|---|---|
| 横幅推送 | macOS 右上角通知，含任务描述 |
| 提示音 | 14 种系统音效可选，切换即试听 |
| 语音播报 | 7 种中文音色可选，切换即试听 |
| 前台静默 | Cursor 在前台时不打扰 |
| 去重保护 | 同一任务 60 秒内只通知一次 |

## 配置

安装后在 Cursor 设置页（`Cmd+,`）搜索 `cursorTaskNotifier`，通过 UI 开关控制各项功能，配置实时写入 `~/.cursor/hooks/task-done.conf`。

## 系统要求

- macOS
- [Cursor](https://cursor.sh) IDE
- [Homebrew](https://brew.sh)（用于安装 terminal-notifier）
