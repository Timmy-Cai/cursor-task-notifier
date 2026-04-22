# Cursor Agent 任务完成通知系统

## 背景

在日常开发中，经常会遇到以下场景：

- 同时开启多个 Cursor 窗口跑多个 Agent 任务
- 任务耗时较长（如批量重构、代码分析），期间切到其他工作
- 任务已完成，但因为没有通知而迟迟没有去查看结果，白白浪费时间

本系统基于 **Cursor Hook 机制**，在 Agent 任务完成时自动触发通知。

**功能清单：**

| 功能 | 说明 |
|---|---|
| 📬 横幅推送 | macOS 右上角通知，含任务描述 |
| 🔔 提示音 | 14 种系统音效可选，切换即试听 |
| 🗣 语音播报 | 7 种中文音色可选，切换即试听 |
| 🔇 前台静默 | Cursor 在前台时不打扰 |
| 🔁 去重保护 | 同一任务 60 秒内只通知一次 |
| ⚙️ UI 配置 | Cursor 设置页一键管理，无需编辑文件 |
| 📝 本地日志 | 错过通知也能回溯 |

**核心策略**：Cursor 在前台时静默，不在前台时才通知，不打扰正常操作。

**开源地址**：https://github.com/Timmy-Cai/cursor-task-notifier

---

## 安装说明

### 一键安装（推荐）

```bash
git clone https://github.com/Timmy-Cai/cursor-task-notifier.git
cd cursor-task-notifier
bash install.sh
```

安装脚本会自动完成以下所有步骤：

- ✅ 检查并安装 `terminal-notifier`（Homebrew）
- ✅ 复制 hook 脚本到 `~/.cursor/hooks/`
- ✅ 合并注册 `hooks.json`（不覆盖已有配置）
- ✅ 编译 `raise-cursor` 可执行文件（点击通知跳回 Cursor）
- ✅ 安装 Cursor 扩展（`.vsix`）

安装完成后需手动完成两步：

1. **重启 Cursor**（必须，让 Hook 和扩展生效）
2. **开通通知权限**：系统设置 → 通知 → `terminal-notifier` → 改为「横幅」或「提醒」

### 文件结构

```plaintext
~/.cursor/
├── hooks.json                  # Hook 注册配置，监听 Agent stop 事件
├── hooks/
│   ├── task-done.sh            # 通知执行脚本（核心）
│   ├── task-done.conf          # 通知配置（由 Cursor 扩展自动管理）
│   └── raise-cursor            # 点击通知跳回 Cursor 的可执行文件
├── rules/
│   └── task-notify.mdc         # AI 规则：大任务前主动询问是否开启通知
└── task-done.log               # 任务完成历史日志（自动生成）
```

---

## 使用说明

### 通知触发条件

| 场景 | 是否通知 |
|---|---|
| Cursor 在前台（你正在操作） | 🔇 静默，不打扰 |
| Cursor 不在前台（切到其他应用） | 🔔 触发完整通知 |

> **说明**：「前台」是 macOS 系统级概念，即当前接收键盘输入的应用。多显示器场景同样适用——Cursor 开在副屏，主屏操作浏览器，视为「不在前台」，会正常通知。

### 通知内容示例

右上角推送：

```plaintext
┌─────────────────────────────────────────┐
│ ✅ broker · 任务完成                     │
│    帮我查一下发送短信逻辑                 │
│                        [点击跳回 Cursor] │
└─────────────────────────────────────────┘
```

语音播报：「**broker 项目任务完成，请查看结果**」

### 在 Cursor 设置页配置（推荐）

安装完成后，在 Cursor 设置页（`Cmd+,`）搜索 `cursorTaskNotifier`，即可通过 UI 开关管理所有配置，**无需手动编辑文件**。

配置分为 4 个分组，从上到下依次为：

| 分组 | 配置项 | 说明 |
|---|---|---|
| **Cursor Task Notifier** | Enabled | 总开关，关闭后其余设置无效 |
| **横幅推送** | Banner | macOS 右上角推送通知 |
| **提示音** | Sound | 提示音开关 |
| | Sound Name | 14 种音效下拉选择，**切换即试听** |
| **语音播报** | Voice | 语音播报开关 |
| | Voice Name | 7 种中文音色下拉选择，**切换即试听** |

**可选音效（14 种）**：Basso、Blow、Bottle、Frog、Funk、Glass、Hero、Morse、Ping、Pop、Purr、Sosumi、Submarine、Tink

**可选语音音色（7 种）**：

| 音色 | 描述 |
|---|---|
| Meijia（美佳） | 台湾女声，清甜温柔（默认） |
| Tingting（婷婷） | 普通话女声，标准清晰 |
| Sinji（善怡） | 粤语女声，香港口音 |
| Grandma（奶奶） | 普通话女声，亲切温暖 |
| Grandpa（爷爷） | 普通话男声，沉稳厚重 |
| Flo | 普通话女声，活泼明快 |
| Reed | 普通话男声，干净利落 |

### 查看历史日志

即使错过了通知，也可以通过日志回溯所有完成记录：

```bash
# 查看最近 20 条
tail -20 ~/.cursor/task-done.log

# 查看今天的
grep "$(date +%Y-%m-%d)" ~/.cursor/task-done.log

# 查看指定项目
grep "broker" ~/.cursor/task-done.log
```

日志格式示例：

```plaintext
[2026-04-19 14:32:01] broker | 帮我查一下发送短信逻辑
[2026-04-19 14:28:45] user_center | 检查登录逻辑
```

### 手动测试

切到其他 App 后，在终端运行：

```bash
cat /tmp/cursor-hook-debug.json | bash ~/.cursor/hooks/task-done.sh
```

---

## 常见问题

### 收不到右上角推送怎么办？

**检查步骤（按顺序排查）：**

1. **确认 terminal-notifier 通知权限**

   系统设置 → 通知 → `terminal-notifier`

   - 通知样式必须是「**横幅**」或「**提醒**」，不能是「无」
   - 推荐改为「**提醒**」，不会自动消失

2. **确认没有开启勿扰模式 / 专注模式**

   系统设置 → 专注模式 → 确认未开启（菜单栏有月亮 🌙 图标说明已开启）

3. **确认通知是否进了通知中心**

   从屏幕右上角向下滑，查看通知中心积压的通知

4. **确认脚本执行正常**

```bash
# 查看调试日志，确认 Hook 收到了数据
cat /tmp/cursor-hook-debug.json
```

如果文件不存在或内容为空，说明 Hook 未触发，需检查 `hooks.json` 路径并重启 Cursor。

### 收不到语音播报怎么办？

```bash
# 确认语音包已安装
say -v "Meijia" "测试"

# 若无法发音，在系统设置里下载中文语音包：
# 系统设置 → 辅助功能 → 朗读内容 → 系统语音 → 管理语音
```

### Hook 未触发怎么办？

1. 检查 `~/.cursor/hooks.json` 格式是否正确（JSON 不能有语法错误）
2. 确认脚本有执行权限：`ls -la ~/.cursor/hooks/task-done.sh`（应有 `x` 标志）
3. 在 Cursor 设置 → Hooks 标签页查看 Hook 加载状态
4. 重启 Cursor

### 多个任务同时完成，通知会叠加吗？

不会。每个 Agent 会话有唯一的 `conversation_id`，内置去重机制确保同一任务 **60 秒内只触发一次**。

---

## 系统架构

```plaintext
Cursor Agent 完成（stop 事件触发）
           │
           ▼
    hooks.json 路由
           │
           ▼
    task-done.sh 执行
    │
    ├─ 读取 task-done.conf（总开关检查）
    ├─ 解析事件 JSON（提取项目名、会话ID、transcript 路径）
    ├─ 读取 transcript（提取最后一条用户指令）
    ├─ 去重检测（同一 conversation_id 60s 内只触发一次）
    ├─ lsappinfo 检测前台应用
    │      └─ Cursor 在前台 → exit 0（静默）
    │
    ├─ 🔔 afplay（提示音）        ▶ 并发执行
    ├─ 🗣  say（语音播报）        ▶ 并发执行
    ├─ 📬 terminal-notifier（右上角推送）  ▶ 并发执行
    └─ 📝 追加写入 task-done.log
```

**Cursor 扩展（cursor-task-notifier）的作用：**

```plaintext
Cursor 设置页修改开关
           │
           ▼
  onDidChangeConfiguration 事件
           │
           ▼
    自动写入 task-done.conf ← 屏蔽 fs.watch 反弹
           │
           ▼
    切换音效 / 音色时自动试听（去重，只播一遍）
```

## 系统要求

- macOS
- [Cursor](https://cursor.sh) IDE
- [Homebrew](https://brew.sh)（用于安装 terminal-notifier）
