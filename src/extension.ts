import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const EXT_ID = 'cursorTaskNotifier';
const CONF_COMMENT = `# Cursor Agent 任务完成通知配置
# 由 Cursor Task Notifier 扩展自动管理，请勿手动修改
# 如需修改，请前往 Cursor 设置页 → Extensions → Cursor Task Notifier
`;

const SOUND_FILES: Record<string, string> = {
    Basso: '/System/Library/Sounds/Basso.aiff',
    Blow: '/System/Library/Sounds/Blow.aiff',
    Bottle: '/System/Library/Sounds/Bottle.aiff',
    Frog: '/System/Library/Sounds/Frog.aiff',
    Funk: '/System/Library/Sounds/Funk.aiff',
    Glass: '/System/Library/Sounds/Glass.aiff',
    Hero: '/System/Library/Sounds/Hero.aiff',
    Morse: '/System/Library/Sounds/Morse.aiff',
    Ping: '/System/Library/Sounds/Ping.aiff',
    Pop: '/System/Library/Sounds/Pop.aiff',
    Purr: '/System/Library/Sounds/Purr.aiff',
    Sosumi: '/System/Library/Sounds/Sosumi.aiff',
    Submarine: '/System/Library/Sounds/Submarine.aiff',
    Tink: '/System/Library/Sounds/Tink.aiff',
};

function getConfPath(): string {
    return path.join(os.homedir(), '.cursor', 'hooks', 'task-done.conf');
}

function boolLine(key: string, value: boolean): string {
    return `${key}=${value ? 'true' : 'false'}`;
}

function writeConf(confPath: string, config: vscode.WorkspaceConfiguration): void {
    const enabled = config.get<boolean>('enabled', true);
    const sound = config.get<boolean>('sound', true);
    const soundName = config.get<string>('soundName', 'Glass');
    const voice = config.get<boolean>('voice', true);
    const voiceName = config.get<string>('voiceName', 'Meijia');
    const banner = config.get<boolean>('banner', true);

    const soundFile = SOUND_FILES[soundName ?? 'Glass'] ?? SOUND_FILES['Glass'];

    const content = [
        CONF_COMMENT,
        boolLine('NOTIFY_ENABLED', enabled),
        '',
        boolLine('NOTIFY_SOUND', sound),
        `NOTIFY_SOUND_FILE=${soundFile}`,
        '',
        boolLine('NOTIFY_VOICE', voice),
        `NOTIFY_VOICE_NAME=${voiceName}`,
        '',
        boolLine('NOTIFY_BANNER', banner),
        '',
    ].join('\n');

    const dir = path.dirname(confPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(confPath, content, 'utf-8');
}

function readConfToSettings(confPath: string): Record<string, boolean | string> {
    const result: Record<string, boolean | string> = {};
    if (!fs.existsSync(confPath)) {
        return result;
    }
    const lines = fs.readFileSync(confPath, 'utf-8').split('\n');
    const boolKeyMap: Record<string, string> = {
        NOTIFY_ENABLED: 'enabled',
        NOTIFY_SOUND: 'sound',
        NOTIFY_VOICE: 'voice',
        NOTIFY_BANNER: 'banner',
    };
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) {
            continue;
        }
        const eqIdx = trimmed.indexOf('=');
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();

        if (boolKeyMap[key]) {
            result[boolKeyMap[key]] = val === 'true';
        } else if (key === 'NOTIFY_SOUND_FILE') {
            const soundName = Object.entries(SOUND_FILES).find(([, v]) => v === val)?.[0];
            if (soundName) {
                result['soundName'] = soundName;
            }
        } else if (key === 'NOTIFY_VOICE_NAME' && val) {
            result['voiceName'] = val;
        }
    }
    return result;
}

function updateStatusBar(bar: vscode.StatusBarItem, config: vscode.WorkspaceConfiguration): void {
    const enabled = config.get<boolean>('enabled', true);
    bar.text = enabled ? '$(bell) 通知已开启' : '$(bell-slash) 通知已关闭';
    bar.tooltip = enabled
        ? 'Cursor Task Notifier 正在运行，点击打开设置'
        : 'Cursor Task Notifier 已关闭，点击打开设置';
}

async function syncConfToVscode(confPath: string): Promise<void> {
    const values = readConfToSettings(confPath);
    if (Object.keys(values).length === 0) {
        return;
    }
    const config = vscode.workspace.getConfiguration(EXT_ID);
    for (const [key, value] of Object.entries(values)) {
        const current = config.get(key);
        if (current !== value) {
            await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const config = vscode.workspace.getConfiguration(EXT_ID);
    const confPath = getConfPath();

    if (fs.existsSync(confPath)) {
        syncConfToVscode(confPath).catch(() => {});
    } else {
        writeConf(confPath, config);
    }

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'workbench.action.openSettings';
    statusBar.show();
    updateStatusBar(statusBar, config);
    context.subscriptions.push(statusBar);

    // 防抖：记录上次预览的 key+value，同一值 3 秒内只播一次
    const previewedRecently = new Map<string, NodeJS.Timeout>();

    const previewOnce = (key: string, value: string, play: () => void): void => {
        const dedupeKey = `${key}:${value}`;
        if (previewedRecently.has(dedupeKey)) {
            return;
        }
        const timer = setTimeout(() => previewedRecently.delete(dedupeKey), 3000);
        previewedRecently.set(dedupeKey, timer);
        play();
    };

    // 写入锁：扩展自己写 conf 期间，屏蔽 fs.watch 反弹
    let isWritingConf = false;

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration(EXT_ID)) {
                return;
            }
            const updated = vscode.workspace.getConfiguration(EXT_ID);
            const targetPath = getConfPath();
            try {
                isWritingConf = true;
                writeConf(targetPath, updated);
                // 延迟解锁，覆盖 macOS fs.watch 的多次回调窗口
                setTimeout(() => { isWritingConf = false; }, 500);
                updateStatusBar(statusBar, updated);

                // 切换音效时立即试听（只播一遍）
                if (e.affectsConfiguration(`${EXT_ID}.soundName`)) {
                    const soundName = updated.get<string>('soundName', 'Glass');
                    const soundFile = SOUND_FILES[soundName ?? 'Glass'] ?? SOUND_FILES['Glass'];
                    previewOnce('soundName', soundName ?? 'Glass', () => {
                        try {
                            execSync(`afplay "${soundFile}"`, { timeout: 5000 });
                        } catch { /* ignore */ }
                    });
                }

                // 切换语音音色时立即试听（只播一遍）
                if (e.affectsConfiguration(`${EXT_ID}.voiceName`)) {
                    const voiceName = updated.get<string>('voiceName', 'Meijia');
                    previewOnce('voiceName', voiceName ?? 'Meijia', () => {
                        try {
                            execSync(`say -v "${voiceName}" "任务完成，请查看结果"`, { timeout: 8000 });
                        } catch { /* ignore */ }
                    });
                }

                vscode.window.setStatusBarMessage('$(check) 通知配置已保存', 3000);
            } catch (err) {
                vscode.window.showErrorMessage(`Cursor Task Notifier: 写入配置失败 — ${err}`);
            }
        })
    );

    let fsWatcher: fs.FSWatcher | undefined;
    const startWatcher = (p: string): void => {
        fsWatcher?.close();
        if (!fs.existsSync(path.dirname(p))) {
            return;
        }
        try {
            let watchDebounce: NodeJS.Timeout | undefined;
            fsWatcher = fs.watch(p, () => {
                // 扩展自己写文件时忽略回调，防止反弹循环
                if (isWritingConf) {
                    return;
                }
                // 防抖：macOS 单次写入可能触发多次事件，合并为一次同步
                clearTimeout(watchDebounce);
                watchDebounce = setTimeout(() => {
                    syncConfToVscode(p).catch(() => {});
                }, 300);
            });
            context.subscriptions.push({ dispose: () => fsWatcher?.close() });
        } catch {
            // ignore
        }
    };
    startWatcher(confPath);

    context.subscriptions.push(
        vscode.commands.registerCommand('cursorTaskNotifier.openConf', () => {
            const p = getConfPath();
            if (fs.existsSync(p)) {
                vscode.window.showTextDocument(vscode.Uri.file(p));
            } else {
                vscode.window.showWarningMessage(`配置文件不存在：${p}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cursorTaskNotifier.testNotify', () => {
            try {
                const script = path.join(os.homedir(), '.cursor', 'hooks', 'task-done.sh');
                const debugJson = '/tmp/cursor-hook-debug.json';
                if (!fs.existsSync(debugJson)) {
                    vscode.window.showWarningMessage(
                        '找不到 /tmp/cursor-hook-debug.json，请先让 Agent 完成一个任务以生成测试数据'
                    );
                    return;
                }
                vscode.window.showInformationMessage(
                    '请先切换到其他应用（如 Finder），3 秒后触发通知'
                );
                setTimeout(() => {
                    try {
                        execSync(`cat ${debugJson} | bash ${script}`, { timeout: 10000 });
                    } catch {
                        // 脚本正常退出码也可能是非 0，忽略
                    }
                }, 1000);
            } catch (err) {
                vscode.window.showErrorMessage(`测试通知执行失败：${err}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cursorTaskNotifier.showStatus', () => {
            const cfg = vscode.workspace.getConfiguration(EXT_ID);
            const p = getConfPath();
            const exists = fs.existsSync(p);
            const panel = vscode.window.createWebviewPanel(
                'taskNotifierStatus',
                'Task Notifier 状态',
                vscode.ViewColumn.One,
                {}
            );
            panel.webview.html = buildStatusHtml(cfg, p, exists);
        })
    );
}

function buildStatusHtml(
    cfg: vscode.WorkspaceConfiguration,
    confPath: string,
    confExists: boolean
): string {
    const row = (label: string, value: boolean) =>
        `<tr><td>${label}</td><td>${value ? '<span class="on">✅ 开启</span>' : '<span class="off">🔕 关闭</span>'}</td></tr>`;

    const soundName = cfg.get<string>('soundName', 'Glass');
    const voiceName = cfg.get<string>('voiceName', 'Meijia');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  h2 { font-size: 18px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; max-width: 520px; }
  td { padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  td:first-child { color: var(--vscode-descriptionForeground); width: 40%; }
  .on { color: #4ec994; font-weight: 600; }
  .off { color: #f48771; font-weight: 600; }
  .accent { color: #79c0ff; font-weight: 600; }
  .path { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 20px; word-break: break-all; }
  .hint { margin-top: 16px; font-size: 13px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h2>🔔 Cursor Task Notifier — 当前状态</h2>
<table>
  ${row('总开关', cfg.get<boolean>('enabled', true))}
  ${row('提示音', cfg.get<boolean>('sound', true))}
  <tr><td>音效</td><td><span class="accent">🎵 ${soundName}</span></td></tr>
  ${row('语音播报', cfg.get<boolean>('voice', true))}
  <tr><td>语音音色</td><td><span class="accent">🗣️ ${voiceName}</span></td></tr>
  ${row('横幅推送', cfg.get<boolean>('banner', true))}
  <tr><td>conf 文件</td><td>${confExists ? '<span class="on">✅ 存在</span>' : '<span class="off">❌ 不存在</span>'}</td></tr>
</table>
<p class="path">📁 ${confPath}</p>
<p class="hint">在 Cursor 设置页搜索 <strong>cursorTaskNotifier</strong> 即可修改配置，切换音效 / 语音时会立即试听。</p>
</body>
</html>`;
}

export function deactivate(): void {}
