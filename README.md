# Cursor Task Notifier

Cursor Agent 跑长任务时，切出去做别的，**任务一完成立刻用提示音 + 语音播报提醒你**，可选右上角横幅推送。零依赖默认即用。

| 功能 | 默认 | 说明 |
|---|---|---|
| 🔔 提示音 | ✅ 开 | 14 种系统音效，切换即试听 |
| 🗣 语音播报 | ✅ 开 | 7 种中文音色，切换即试听 |
| 📬 横幅推送 | ⚪ 关 | 可选进阶，开启需装 `terminal-notifier` |
| 🔇 前台静默 | ✅ | Cursor 在前台时不打扰 |
| 🔁 去重保护 | ✅ | 同一会话 60 秒内只通知一次 |
| ⚙️ UI 配置 | ✅ | Cursor 设置页开关管理 |

---

## 安装

在 **[Open VSX Registry](https://open-vsx.org/extension/timmy-ai/cursor-task-notifier)** 或 Cursor 扩展视图里搜 **Cursor Task Notifier** 一键安装。

![img_1.png](img_1.png)

**装完即用，无需重启 Cursor**。扩展会自动部署 Hook 脚本、注册 `hooks.json`。

---

## 默认体验：零依赖，零配置

装完什么都不用做，Agent 任务完成时你就会听到：

- 🎵 **Glass 提示音**
- 🗣️ **美佳姐姐语音播报**：「项目名 项目任务完成，请查看结果」

**触发条件**：Cursor 不在前台时才响（你正在操作 Cursor 时不打扰）。

想立刻体验？`Cmd + Shift + P` → **Cursor Task Notifier: 发送测试通知**。

---

## 进阶：开启右上角横幅推送

横幅推送是**可选功能**，默认关闭。因为做得不完整——只用 macOS 自带 `osascript` 的话，**点击横幅会打开"脚本编辑器"而非跳回 Cursor**，这是 AppleScript 的系统限制，没法绕。

所以本扩展设计上**只在装了 `terminal-notifier` 时提供横幅推送**，保证点击一定跳回 Cursor。

### 开启步骤

1. 在 Cursor 设置页搜 `cursorTaskNotifier`，打开 **Banner** 开关
2. 扩展会自动检测 `terminal-notifier` 是否已装，未装会弹提示让你一键安装
3. 点「**一键安装 terminal-notifier**」→ 扩展在内置终端里执行 `brew install terminal-notifier`
4. 装完**无需重启 Cursor**，下次任务完成自动弹横幅
5. **首次弹横幅时 macOS 会申请 terminal-notifier 的通知权限，点允许**

### 效果

```text
┌───────────────────────────────────────┐
│ ✅ 项目名 · 任务完成                 │
│    任务内容摘要                       │
└───────────────────────────────────────┘
       ↑ 点任意位置 → 跳回 Cursor
```

### 手动安装（可选）

也可以跳过扩展引导自己装：

```bash
brew install terminal-notifier
xcode-select --install   # 用于编译 raise-cursor 小程序，已装可跳过
```

装完下次任务完成自动启用。

---

## 配置

Cursor 设置页搜 `cursorTaskNotifier`，用 UI 开关管理，**无需改文件**。

![img.png](img.png)

配置从上到下四组：

| 分组 | 配置 | 默认 | 说明 |
|---|---|---|---|
| Cursor Task Notifier | Enabled | ✅ 开 | 总开关 |
| 提示音 | Sound / Sound Name | ✅ 开，Glass | 14 种音效，切换即试听 |
| 语音播报 | Voice / Voice Name | ✅ 开，Meijia | 7 种中文音色，切换即试听 |
| 横幅推送 | Banner | ⚪ 关 | 需配合 terminal-notifier |

**音效（14 种）**：Basso、Blow、Bottle、Frog、Funk、Glass、Hero、Morse、Ping、Pop、Purr、Sosumi、Submarine、Tink

**中文语音（7 种）**：Meijia（美佳，默认）、Tingting、Sinji、Grandma、Grandpa、Flo、Reed

---

## 常见问题

### 为什么横幅默认关闭？

如果不配 `terminal-notifier`，点击横幅会打开"脚本编辑器"而非 Cursor——这是 AppleScript 固有行为。**与其给半成品体验，不如默认关闭**，让用户在开启时得到明确引导。

### 开启横幅后却没看到？

1. 确认已装 `terminal-notifier`：`which terminal-notifier`
2. 系统设置 → 通知 → 找「**terminal-notifier**」，通知样式设为「**横幅**」或「**提醒**」
3. 确认未开专注模式 🌙
4. `Cmd + Shift + P` → **Cursor Task Notifier: 查看当前状态** 看依赖情况

### 收不到语音？

```bash
say -v Meijia "测试"
# 无声：系统设置 → 辅助功能 → 朗读内容 → 系统语音 → 管理语音，下载中文语音
```

### 改过 `~/.cursor/hooks/task-done.conf`，升级会覆盖吗？

不会。扩展只在 conf 不存在时初始化，已有配置保留。在设置页改配置会正向同步进 conf 文件。

### 如何卸载？

```bash
# 1. 卸载扩展
/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
  --uninstall-extension timmy-ai.cursor-task-notifier

# 2. 清理 Hook 资源
rm -f ~/.cursor/hooks/task-done.{sh,conf} \
      ~/.cursor/hooks/raise-cursor \
      ~/.cursor/hooks/raise-cursor.swift

# 3. 编辑 ~/.cursor/hooks.json，删掉 task-done.sh 那条 stop hook（或 rm 整个文件）
```

---

## 系统要求

| 依赖 | 要求 |
|---|---|
| macOS | 13 Ventura+ |
| Cursor | 支持 Hook 机制（2.x+） |
| Python3 | 系统自带 |
| terminal-notifier | 可选，开启横幅时需要 |
| Xcode Command Line Tools | 可选，搭配 terminal-notifier 用 |
| 中文语音包 | 可选，语音播报需下载 |
