import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const EXT_ID = 'cursorTaskNotifier';
const INSTALLED_VERSION_KEY = 'cursorTaskNotifier.installedAssetVersion';
// 每次修改 hooks/ 里的脚本内容，这个版本号 +1，触发旧用户的 hook 脚本覆盖升级
const ASSET_VERSION = 5;
// 一次性迁移标记：v0.6.1 起把 banner 默认值从 true 改为 false。
// 不论是否已装 terminal-notifier，老用户残留的 banner=true 都重置回新默认。
// flag 后缀 .v2 是为了让 0.6.1-preview 用户重新触发迁移（旧 flag 残留导致误跳过）。
const MIGRATION_BANNER_DEFAULT_FALSE = 'cursorTaskNotifier.migrations.bannerDefaultFalse.v2';

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
    const banner = config.get<boolean>('banner', false);

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
    // 默认体验：提示音 + 语音，零依赖零权限。
    // 横幅默认关闭，需要时用户在设置页打开；开启动作会触发 terminal-notifier 引导。
    if (result.isFirstInstall) {
        const msg = 'Cursor Task Notifier 已就绪 🎉\n\n'
            + '默认会在 Agent 任务完成时播放提示音 + 语音播报，零依赖开箱即用。\n\n'
            + '想要「右上角横幅推送 + 点击跳回 Cursor」？在设置里开启「横幅推送」，扩展会引导你完成安装。';

        const picked = await vscode.window.showInformationMessage(
            msg,
            '打开扩展设置',
            '知道了'
        );
        if (picked === '打开扩展设置') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                '@ext:timmy-ai.cursor-task-notifier'
            );
        }
        return;
    }
    // 非首次：不再弹窗打扰。状态可在「查看当前状态」命令里看。
    void context;
}

// 用户在设置页打开「横幅推送」开关时调用。
// 若 terminal-notifier 未装，引导用户一键安装；装了则即时响应一声"已开启"。
async function handleBannerEnabled(): Promise<void> {
    const tnPath = findTerminalNotifier();
    if (tnPath) {
        vscode.window.showInformationMessage(
            `横幅推送已开启 🚀 使用 terminal-notifier (${tnPath})，点击横幅可直接跳回 Cursor。`
        );
        return;
    }

    const msg = '横幅推送需要 terminal-notifier 才能正常工作 ⚠️\n\n'
        + '未安装时，macOS 会用 osascript 发出通知，但点击横幅会打开"脚本编辑器"而非 Cursor —— 这是 AppleScript 的系统限制。\n\n'
        + '建议安装 terminal-notifier（500KB 纯 CLI 工具，无后台服务），开箱支持点击跳回。';

    const picked = await vscode.window.showWarningMessage(
        msg,
        '一键安装 terminal-notifier',
        '先关闭横幅',
        '我已了解，继续保持'
    );

    if (picked === '一键安装 terminal-notifier') {
        await installTerminalNotifier();
    } else if (picked === '先关闭横幅') {
        await vscode.workspace.getConfiguration(EXT_ID)
            .update('banner', false, vscode.ConfigurationTarget.Global);
    }
}

// 一次性迁移：v0.6.0 起 banner 默认从 true 改为 false。
// 老用户的 settings.json / conf 里残留 banner=true 是来自 v0.5.x 的旧默认值，
// 不能视为"用户主动选择"——重置回新默认值 false，给所有人新的清爽起点。
// 已装 terminal-notifier 的用户想用横幅，主动打开开关一键即可（扩展会立刻确认"已就绪"，无感切换）。
async function migrateBannerDefaultIfNeeded(context: vscode.ExtensionContext): Promise<void> {
    if (context.globalState.get<boolean>(MIGRATION_BANNER_DEFAULT_FALSE, false)) {
        return;
    }

    try {
        const config = vscode.workspace.getConfiguration(EXT_ID);
        const inspect = config.inspect<boolean>('banner');
        const userValue = inspect?.globalValue;

        // settings 里显式存的 true（不管是用户改的还是老默认值同步进去的）一律重置
        if (userValue === true) {
            // undefined 表示"使用 package.json 里的 default"（即 false）
            await config.update('banner', undefined, vscode.ConfigurationTarget.Global);
        }

        // 同步改写 conf 文件里的 NOTIFY_BANNER=true，避免 syncConfToVscode 又把 true 拉回 settings
        const confPath = getConfPath();
        if (fs.existsSync(confPath)) {
            const content = fs.readFileSync(confPath, 'utf-8');
            const updated = content.replace(/^NOTIFY_BANNER=true$/m, 'NOTIFY_BANNER=false');
            if (updated !== content) {
                fs.writeFileSync(confPath, updated, 'utf-8');
            }
        }
    } catch {
        // 迁移失败不影响功能，下次启动还会再尝试（不打 flag）
        return;
    }

    await context.globalState.update(MIGRATION_BANNER_DEFAULT_FALSE, true);
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
    const bannerOn = vscode.workspace.getConfiguration(EXT_ID).get<boolean>('banner', false);
    const tnInstalled = !!findTerminalNotifier();
    if (bannerOn && tnInstalled) {
        vscode.window.showInformationMessage(
            '演示通知已发出 🎯 右上角应出现横幅，点击即可跳回 Cursor。'
        );
    } else if (bannerOn && !tnInstalled) {
        vscode.window.showWarningMessage(
            '演示通知已发出，但横幅推送需要 terminal-notifier。请在扩展设置里重新触发开启以完成安装引导，或关闭横幅回到零依赖模式。'
        );
    } else {
        vscode.window.showInformationMessage(
            '演示已发出 🔔 你应该听到提示音 + 语音播报。想开横幅？在扩展设置里打开「横幅推送」。'
        );
    }
}

async function installTerminalNotifier(): Promise<void> {
    try {
        execSync('command -v brew', { stdio: 'ignore' });
    } catch {
        vscode.window.showErrorMessage(
            '未检测到 Homebrew，请先安装 Homebrew（https://brew.sh），再执行 brew install terminal-notifier。'
        );
        return;
    }

    const terminal = vscode.window.createTerminal({ name: 'Install terminal-notifier' });
    terminal.show();
    terminal.sendText('brew install terminal-notifier');
    vscode.window.showInformationMessage(
        '已在终端发起 brew install terminal-notifier，装完后下次 Agent 任务完成自动启用横幅 + 点击跳回（无需重启 Cursor）。'
    );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration(EXT_ID);
    const confPath = getConfPath();

    // 先部署 hook 运行所需的一切资源
    const deployResult = ensureHooksInstalled(context, config);

    // 一次性迁移：v0.6.0 banner 默认值改为 false 后，先于 syncConfToVscode 跑，
    // 把老用户残留的 banner=true（无 tn 状态）刷回新默认值，避免被 conf 反向拉回
    await migrateBannerDefaultIfNeeded(context);

    // 异步弹引导（不阻塞 activate）
    showInstallGuidance(context, deployResult).catch(() => {});

    if (fs.existsSync(confPath)) {
        await syncConfToVscode(confPath).catch(() => {});
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

                // 横幅推送开关从关变开：检查依赖并引导安装 terminal-notifier
                if (e.affectsConfiguration(`${EXT_ID}.banner`)
                    && updated.get<boolean>('banner', false)) {
                    void handleBannerEnabled();
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
  ${row('横幅推送（可选进阶）', cfg.get<boolean>('banner', false))}
</table>

<h3>运行时依赖</h3>
<table>
  ${existRow('task-done.sh (Hook 脚本)', runtime.hookScriptExists)}
  ${existRow('hooks.json (Cursor 注册)', runtime.hooksJsonExists)}
  ${existRow('task-done.conf', confExists)}
</table>

<h3>横幅推送状态</h3>
<table>
  <tr><td>横幅开关</td><td>${cfg.get<boolean>('banner', false)
      ? `<span class="on">✅ 已开启</span>`
      : `<span class="off">⚪ 未开启（默认，在设置里打开即可）</span>`}</td></tr>
  <tr><td>terminal-notifier</td><td>${runtime.terminalNotifierPath
      ? `<span class="on">✅ ${runtime.terminalNotifierPath}</span>`
      : `<span class="off">❌ 未安装（开启横幅需先安装）</span>`}</td></tr>
  ${existRow('raise-cursor (点击跳回)', runtime.raiseCursorExists,
      '✅ 已就绪', '⚪ 未部署（装好 terminal-notifier 后自动编译）')}
</table>

<p class="path">📁 ${confPath}</p>
<p class="hint">
<strong>默认体验（零依赖）</strong>：任务完成时提示音 + 语音播报，不触发任何系统通知权限申请。<br/>
<strong>横幅推送（进阶）</strong>：需安装 <code>brew install terminal-notifier</code>。扩展监测到你打开开关会自动引导。不走 osascript 通道，因为 AppleScript 的点击行为是打开脚本编辑器而非 Cursor，体验不完整。</p>
</body>
</html>`;
}

export function deactivate(): void {}
