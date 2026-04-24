import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const EXT_ID = 'cursorTaskNotifier';
const INSTALLED_VERSION_KEY = 'cursorTaskNotifier.installedAssetVersion';
// 每次修改 hooks/ 里的脚本内容，这个版本号 +1，触发旧用户的 hook 脚本覆盖升级
const ASSET_VERSION = 4;

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

function getCursorDir(): string {
    return path.join(os.homedir(), '.cursor');
}
function getHooksDir(): string {
    return path.join(getCursorDir(), 'hooks');
}
function getConfPath(): string {
    return path.join(getHooksDir(), 'task-done.conf');
}
function getHookScriptPath(): string {
    return path.join(getHooksDir(), 'task-done.sh');
}
function getRaiseCursorBinPath(): string {
    return path.join(getHooksDir(), 'raise-cursor');
}
function getHooksJsonPath(): string {
    return path.join(getCursorDir(), 'hooks.json');
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

// ────────────────────────────────────────────────────────────────
// 资源部署：确保 hook 脚本、hooks.json、raise-cursor 都存在
// ────────────────────────────────────────────────────────────────

interface DeployResult {
    isFirstInstall: boolean;
    hookScriptDeployed: boolean;
    hooksJsonRegistered: boolean;
    terminalNotifierFound: boolean;
    raiseCursorAvailable: boolean;
    errors: string[];
}

function findTerminalNotifier(): string | undefined {
    const candidates = [
        '/opt/homebrew/bin/terminal-notifier',
        '/usr/local/bin/terminal-notifier',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    try {
        const out = execSync('command -v terminal-notifier', { encoding: 'utf-8' }).trim();
        if (out && fs.existsSync(out)) {
            return out;
        }
    } catch {
        // 没找到
    }
    return undefined;
}

function deployHookScript(extensionPath: string): boolean {
    const src = path.join(extensionPath, 'hooks', 'task-done.sh');
    const dst = getHookScriptPath();
    if (!fs.existsSync(src)) {
        return false;
    }
    const dir = path.dirname(dst);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(src, dst);
    try {
        fs.chmodSync(dst, 0o755);
    } catch {
        // ignore
    }
    return true;
}

function deployRaiseCursor(extensionPath: string): boolean {
    const dst = getRaiseCursorBinPath();
    if (fs.existsSync(dst)) {
        return true;
    }
    const swiftSrc = path.join(extensionPath, 'hooks', 'raise-cursor.swift');
    if (!fs.existsSync(swiftSrc)) {
        return false;
    }
    try {
        execSync(`swiftc "${swiftSrc}" -o "${dst}"`, { timeout: 60000, stdio: 'ignore' });
        return fs.existsSync(dst);
    } catch {
        return false;
    }
}

function registerHooksJson(): boolean {
    const hooksJsonPath = getHooksJsonPath();
    const dir = path.dirname(hooksJsonPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const hookEntry = { command: 'hooks/task-done.sh', timeout: 15 };

    interface HookEntry { command?: string; timeout?: number; [k: string]: unknown }
    interface HooksJson { version?: number; hooks?: { stop?: HookEntry[]; [k: string]: HookEntry[] | undefined } }

    let data: HooksJson = { version: 1, hooks: { stop: [] } };
    if (fs.existsSync(hooksJsonPath)) {
        try {
            const raw = fs.readFileSync(hooksJsonPath, 'utf-8');
            data = JSON.parse(raw) as HooksJson;
        } catch {
            // 文件损坏时用默认结构覆盖，但做个备份
            try {
                fs.copyFileSync(hooksJsonPath, `${hooksJsonPath}.bak-${Date.now()}`);
            } catch { /* ignore */ }
        }
    }

    if (!data.hooks) { data.hooks = {}; }
    if (!Array.isArray(data.hooks.stop)) { data.hooks.stop = []; }
    if (data.version === undefined) { data.version = 1; }

    const stopHooks = data.hooks.stop;
    const alreadyRegistered = stopHooks.some((h) => typeof h?.command === 'string' && h.command.includes('task-done.sh'));
    if (!alreadyRegistered) {
        stopHooks.push(hookEntry);
    }

    fs.writeFileSync(hooksJsonPath, JSON.stringify(data, null, 2), 'utf-8');
    // 额外 touch 一次 mtime，最大化 Cursor fs.watch 触发概率（官方声明 hooks.json 是热监听的）
    try {
        const now = new Date();
        fs.utimesSync(hooksJsonPath, now, now);
    } catch { /* ignore */ }
    return true;
}

function ensureHooksInstalled(
    context: vscode.ExtensionContext,
    config: vscode.WorkspaceConfiguration,
): DeployResult {
    const errors: string[] = [];
    const installedVer = context.globalState.get<number>(INSTALLED_VERSION_KEY, 0);
    const isFirstInstall = installedVer === 0;
    const needUpgrade = installedVer < ASSET_VERSION;

    let hookScriptDeployed = fs.existsSync(getHookScriptPath());
    if (!hookScriptDeployed || needUpgrade) {
        try {
            hookScriptDeployed = deployHookScript(context.extensionPath);
            if (!hookScriptDeployed) {
                errors.push('task-done.sh 部署失败（扩展包内缺少 hooks/task-done.sh）');
            }
        } catch (e) {
            errors.push(`部署 task-done.sh 失败：${e}`);
        }
    }

    let hooksJsonRegistered = false;
    try {
        hooksJsonRegistered = registerHooksJson();
    } catch (e) {
        errors.push(`写入 hooks.json 失败：${e}`);
    }

    if (!fs.existsSync(getConfPath())) {
        try {
            writeConf(getConfPath(), config);
        } catch (e) {
            errors.push(`写入 task-done.conf 失败：${e}`);
        }
    }

    const raiseCursorAvailable = deployRaiseCursor(context.extensionPath);
    const terminalNotifierFound = !!findTerminalNotifier();

    context.globalState.update(INSTALLED_VERSION_KEY, ASSET_VERSION);

    return {
        isFirstInstall,
        hookScriptDeployed,
        hooksJsonRegistered,
        terminalNotifierFound,
        raiseCursorAvailable,
        errors,
    };
}

async function showInstallGuidance(
    context: vscode.ExtensionContext,
    result: DeployResult,
): Promise<void> {
    if (result.errors.length > 0) {
        vscode.window.showErrorMessage(
            `Cursor Task Notifier 初始化遇到问题：${result.errors.join('；')}`
        );
    }

    // 首次安装：零重启、开箱即用引导。
    // Cursor 官方保证 hooks.json 是热监听的，扩展写完后立刻生效，无需重启。
    // 主动触发一次演示通知，强制 macOS 权限对话框弹出，用户当场看见并授权。
    if (result.isFirstInstall) {
        const msg = 'Cursor Task Notifier 已就绪，Agent 任务完成后会自动推送 macOS 横幅。'
            + '首次触发时 macOS 会弹「脚本编辑器」的通知权限申请，请点「允许」。';

        const actions: string[] = ['立即发送演示通知', '打开通知权限设置'];
        if (!result.terminalNotifierFound) {
            actions.push('启用点击跳回（可选）');
        }
        actions.push('知道了');

        const picked = await vscode.window.showInformationMessage(msg, ...actions);
        if (picked === '立即发送演示通知') {
            await fireDemoNotification();
        } else if (picked === '打开通知权限设置') {
            try {
                execSync('open "x-apple.systempreferences:com.apple.preference.notifications"');
            } catch { /* ignore */ }
        } else if (picked === '启用点击跳回（可选）') {
            await installTerminalNotifier();
        }
        return;
    }
    // 非首次：不再弹窗打扰。状态可在「查看当前状态」命令里看。
    void context;
}

async function fireDemoNotification(): Promise<void> {
    const script = getHookScriptPath();
    if (!fs.existsSync(script)) {
        vscode.window.showErrorMessage('Hook 脚本未部署，请重新加载窗口后重试。');
        return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    const mock = JSON.stringify({
        conversation_id: `demo-${Date.now()}`,
        transcript_path: '',
        workspace_roots: [workspaceRoot],
    });
    // 通过 CURSOR_NOTIFIER_TEST=1 跳过前台检测和去重，确保当前即便在 Cursor 前台也能看到通知
    try {
        execSync(`echo '${mock.replace(/'/g, "'\\''")}' | CURSOR_NOTIFIER_TEST=1 bash "${script}"`,
            { timeout: 10000 });
    } catch {
        // 脚本后台化了提示音/语音/通知，同步返回的 exit code 可能非 0，忽略
    }
    vscode.window.showInformationMessage(
        '演示通知已发出。如果没看到横幅，请检查「系统设置 → 通知 → 脚本编辑器」是否允许通知。'
    );
}

async function installTerminalNotifier(): Promise<void> {
    try {
        execSync('command -v brew', { stdio: 'ignore' });
    } catch {
        vscode.window.showErrorMessage(
            '未检测到 Homebrew，请先安装 Homebrew（https://brew.sh），再执行 brew install terminal-notifier。'
            + '（注意：terminal-notifier 只是可选增强，不装也能正常弹横幅）'
        );
        return;
    }

    const terminal = vscode.window.createTerminal({ name: 'Install terminal-notifier' });
    terminal.show();
    terminal.sendText('brew install terminal-notifier');
    vscode.window.showInformationMessage(
        '已在终端发起 brew install terminal-notifier，安装完成后重启 Cursor 即可启用点击横幅跳回功能。'
    );
}

export function activate(context: vscode.ExtensionContext): void {
    const config = vscode.workspace.getConfiguration(EXT_ID);
    const confPath = getConfPath();

    // 先部署 hook 运行所需的一切资源
    const deployResult = ensureHooksInstalled(context, config);

    // 异步弹引导（不阻塞 activate）
    showInstallGuidance(context, deployResult).catch(() => {});

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
                setTimeout(() => { isWritingConf = false; }, 500);
                updateStatusBar(statusBar, updated);

                if (e.affectsConfiguration(`${EXT_ID}.soundName`)) {
                    const soundName = updated.get<string>('soundName', 'Glass');
                    const soundFile = SOUND_FILES[soundName ?? 'Glass'] ?? SOUND_FILES['Glass'];
                    previewOnce('soundName', soundName ?? 'Glass', () => {
                        try {
                            execSync(`afplay "${soundFile}"`, { timeout: 5000 });
                        } catch { /* ignore */ }
                    });
                }

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
                if (isWritingConf) {
                    return;
                }
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
        vscode.commands.registerCommand('cursorTaskNotifier.testNotify', async () => {
            await fireDemoNotification();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cursorTaskNotifier.showStatus', () => {
            const cfg = vscode.workspace.getConfiguration(EXT_ID);
            const p = getConfPath();
            const exists = fs.existsSync(p);
            const hookScriptExists = fs.existsSync(getHookScriptPath());
            const hooksJsonExists = fs.existsSync(getHooksJsonPath());
            const tnPath = findTerminalNotifier();
            const raiseOk = fs.existsSync(getRaiseCursorBinPath());
            const panel = vscode.window.createWebviewPanel(
                'taskNotifierStatus',
                'Task Notifier 状态',
                vscode.ViewColumn.One,
                {}
            );
            panel.webview.html = buildStatusHtml(cfg, p, exists, {
                hookScriptExists,
                hooksJsonExists,
                terminalNotifierPath: tnPath,
                raiseCursorExists: raiseOk,
            });
        })
    );
}

interface RuntimeStatus {
    hookScriptExists: boolean;
    hooksJsonExists: boolean;
    terminalNotifierPath: string | undefined;
    raiseCursorExists: boolean;
}

function buildStatusHtml(
    cfg: vscode.WorkspaceConfiguration,
    confPath: string,
    confExists: boolean,
    runtime: RuntimeStatus
): string {
    const row = (label: string, value: boolean) =>
        `<tr><td>${label}</td><td>${value ? '<span class="on">✅ 开启</span>' : '<span class="off">🔕 关闭</span>'}</td></tr>`;

    const existRow = (label: string, ok: boolean, okText = '✅ 已就绪', noText = '❌ 缺失') =>
        `<tr><td>${label}</td><td>${ok ? `<span class="on">${okText}</span>` : `<span class="off">${noText}</span>`}</td></tr>`;

    const soundName = cfg.get<string>('soundName', 'Glass');
    const voiceName = cfg.get<string>('voiceName', 'Meijia');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  h2 { font-size: 18px; margin-bottom: 16px; }
  h3 { font-size: 14px; margin: 24px 0 8px; color: var(--vscode-descriptionForeground); }
  table { border-collapse: collapse; width: 100%; max-width: 560px; }
  td { padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  td:first-child { color: var(--vscode-descriptionForeground); width: 40%; }
  .on { color: #4ec994; font-weight: 600; }
  .off { color: #f48771; font-weight: 600; }
  .accent { color: #79c0ff; font-weight: 600; }
  .path { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 12px; word-break: break-all; }
  .hint { margin-top: 16px; font-size: 13px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h2>🔔 Cursor Task Notifier — 当前状态</h2>

<h3>开关</h3>
<table>
  ${row('总开关', cfg.get<boolean>('enabled', true))}
  ${row('提示音', cfg.get<boolean>('sound', true))}
  <tr><td>音效</td><td><span class="accent">🎵 ${soundName}</span></td></tr>
  ${row('语音播报', cfg.get<boolean>('voice', true))}
  <tr><td>语音音色</td><td><span class="accent">🗣️ ${voiceName}</span></td></tr>
  ${row('横幅推送', cfg.get<boolean>('banner', true))}
</table>

<h3>运行时依赖</h3>
<table>
  ${existRow('task-done.sh (Hook 脚本)', runtime.hookScriptExists)}
  ${existRow('hooks.json (Cursor 注册)', runtime.hooksJsonExists)}
  ${existRow('task-done.conf', confExists)}
</table>

<h3>横幅推送通道</h3>
<table>
  <tr><td>当前使用</td><td>${runtime.terminalNotifierPath
      ? `<span class="accent">🚀 terminal-notifier（增强版，支持点击跳回）</span>`
      : `<span class="accent">🍎 osascript（系统自带，零依赖）</span>`}</td></tr>
  <tr><td>terminal-notifier</td><td>${runtime.terminalNotifierPath
      ? `<span class="on">✅ ${runtime.terminalNotifierPath}</span>`
      : `<span class="off">⚪ 未安装（可选，不影响基础功能）</span>`}</td></tr>
  ${existRow('raise-cursor (点击跳回)', runtime.raiseCursorExists,
      '✅ 已就绪', '⚪ 未部署（需 terminal-notifier 才能用）')}
</table>

<p class="path">📁 ${confPath}</p>
<p class="hint">横幅推送默认走 macOS 自带的 osascript，<strong>无需任何安装</strong>。首次弹通知前 macOS 会请求「脚本编辑器」的通知权限，点允许即可。<br/>
想要「点击横幅跳回 Cursor」这个增强体验？安装 <code>brew install terminal-notifier</code> 后重启即可自动启用。</p>
</body>
</html>`;
}

export function deactivate(): void {}
