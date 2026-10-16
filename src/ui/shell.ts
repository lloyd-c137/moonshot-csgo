import type { AccountStats } from '../net/protocol';
import type { CampusRoom } from '../world/roomIndex';

import { formatWinRate } from './formatStats';
import { KIND_FALLBACK_LABEL, KIND_STRIPE } from './kinds';
import { createMapRenderer } from './minimap';
import type { MapMarkers } from './minimap';
import type { Settings } from './settings';
import { SETTING_RANGES } from './settings';
import './theme.css';

export type LoadStage = 'physics' | 'campus' | 'structure' | 'dressing' | 'characters';
const STAGES: [LoadStage, string][] = [
    ['physics', '物理引擎'],
    ['campus', '校园模型与房间数据'],
    ['structure', '墙体、门洞与碰撞'],
    ['dressing', '家具、灯光与地图'],
    ['characters', '骨骼角色与动作']
];

export type AccountView = AccountStats;
export type KingView = { name: string; kills: number; since: number };
export type BoardView = { king: KingView | null; top: AccountView[]; online: number };

type Actions = {
    enter: () => void;
    logout: () => Promise<void>;
    loadBoard: () => Promise<BoardView>;
    recover: () => void;
    settingsChanged: (settings: Settings) => void;
};

const MARKUP = `
<div id="app-ui" data-screen="loading" data-map="closed">
  <button id="execute-button" class="execute-button" type="button" hidden><span class="kbd">V</span> 处决 <b id="execute-target"></b></button>
  <div id="execution-banner" class="execution-banner" hidden><strong id="execution-label"></strong><span>双方动作同步 · 动画完成后淘汰并进入观战</span><i><i id="execution-progress"></i></i></div>
  <section class="screen screen-title" aria-labelledby="title-heading">
    <div class="plan" aria-hidden="true"></div>
    <div class="title-shade" aria-hidden="true"></div>
    <div class="scanlines" aria-hidden="true"></div>
    <header class="title-top">
      <div class="brand"><span class="brand-mark">FF-01</span><b>MOONSHOT</b><span>FRISBEE GAMES</span></div>
      <nav class="title-tabs" role="tablist" aria-label="菜单">
        <button type="button" role="tab" data-tab="play" aria-selected="true">开始游戏</button>
        <button type="button" role="tab" data-tab="board" aria-selected="false">排行榜</button>
        <button type="button" role="tab" data-tab="help" aria-selected="false">操作说明</button>
        <button type="button" role="tab" data-tab="changelog" aria-selected="false">更新日志</button>
      </nav>
      <div class="title-status" id="title-status" data-state="offline"><i aria-hidden="true"></i><span id="title-online">离线练习</span></div>
    </header>
    <div class="title-body">
      <div class="title-left">
        <section class="tab-panel" data-panel="play">
          <p class="mode-tag"><span>模式</span>飞盘大乱斗 · 全服同图</p>
          <h1 id="title-heading">MOONSHOT<br />FRISBEE GAMES</h1>
          <dl class="match-facts">
            <div><dt>地图</dt><dd>FF-01 校园一层</dd></div>
            <div><dt>规则</dt><dd>身体两次 · 爆头直接淘汰</dd></div>
            <div><dt>复活</dt><dd>2.5 秒 · 1.5 秒保护</dd></div>
          </dl>
          <div class="operator" id="operator" data-mode="form">
            <form class="operator-auth" id="auth-form" novalidate>
              <label class="field" for="auth-name"><span>用户名</span><input id="auth-name" type="text" maxlength="16" autocomplete="username" spellcheck="false" placeholder="2–16 个字符" /></label>
              <label class="field" for="auth-password"><span>密码</span><input id="auth-password" type="password" maxlength="64" autocomplete="current-password" placeholder="至少 6 位" /></label>
              <button type="submit" hidden></button>
            </form>
            <p class="operator-hint" id="operator-hint">输入用户名和密码即可进入；新用户名会自动注册，战绩永久保存。</p>
            <div class="operator-signed">
              <div class="operator-id"><span class="operator-avatar" aria-hidden="true"></span><b id="account-name"></b><button class="link" id="logout-button" type="button">退出登录</button></div>
              <dl class="operator-stats">
                <div><dt>累计淘汰</dt><dd id="account-kills">0</dd></div>
                <div><dt>胜率指数</dt><dd id="account-win-rate">—</dd></div>
                <div><dt>被淘汰</dt><dd id="account-deaths">0</dd></div>
                <div><dt>已结算局数</dt><dd id="account-rounds">0</dd></div>
              </dl>
            </div>
            <p class="operator-error" id="auth-error" role="alert" hidden></p>
          </div>
        </section>
        <section class="tab-panel" data-panel="board" hidden>
          <h2 class="panel-title">全服累计排行</h2>
          <table class="board-table"><thead><tr><th>#</th><th>玩家</th><th>淘汰数</th><th>胜率指数</th></tr></thead><tbody id="board-rows"><tr><td colspan="4">加载中…</td></tr></tbody></table>
          <p class="fine-print">指数初始为 100%；每场明确落败后乘以 0.95，胜局与平局保持不变。实际胜负场数仍单独记录；这是按输局递减的展示指数，不是胜场比例。</p>
        </section>
        <section class="tab-panel changelog-panel" data-panel="changelog" hidden>
          <h2 class="panel-title">更新日志</h2>
          <p class="release-intro">按发布日期记录已上线的玩法与改进。</p>
          <ol class="release-list">
            <li class="release-entry" data-current="true">
              <header><b>v0.0.0 · 2026.10.16</b><span>当前版本</span></header>
              <h3>FF-01 自由漫游与多人飞盘玩法</h3>
              <ul>
                <li>接入 FF-01 校园模型、房间识别、第一人称移动和碰撞。</li>
                <li>加入金飞盘回合、淘汰排行榜、聊天、夜间保安与配电室断电机制。</li>
                <li>加入背后处决、同步动作、爆头淘汰，以及金飞盘击杀和飞盘破空音效。</li>
                <li>开发测试模式提供固定自动复活人偶和 P 音效测试面板。</li>
                <li>地图新增配电室、监控室、体育办公室标记。</li>
                <li>监控室内新增电脑，瞄准后点击可查看其他玩家位置 30 秒。</li>
                <li>胜率指数从 100% 起步；输局每次乘以 0.95，胜局和平局不改变该值。</li>
                <li>更新日志加入首页菜单，罚站期间不会显示脱困提示。</li>
              </ul>
            </li>
          </ol>
        </section>
        <section class="tab-panel" data-panel="help" hidden>
          <h2 class="panel-title">操作说明</h2>
          <dl class="controls">
            <div><dt><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span></dt><dd>移动</dd></div>
            <div><dt><span class="kbd">Shift</span></dt><dd>冲刺</dd></div>
            <div><dt><span class="kbd">空格</span></dt><dd>跳跃</dd></div>
            <div><dt><span class="kbd">左键</span></dt><dd>按住蓄力，松开投掷飞盘</dd></div>
            <div><dt><span class="kbd">点击</span></dt><dd>在监控室对准电脑查看其他玩家位置</dd></div>
            <div><dt><span class="kbd">F</span></dt><dd>检视飞盘</dd></div>
            <div><dt><span class="kbd">E</span></dt><dd>西侧 SVC-10 配电室拉闸（全服每局一次）</dd></div>
            <div><dt><span class="kbd">V</span></dt><dd>靠近玩家背后处决；完成后对方观战到下一局</dd></div>
            <div><dt><span class="kbd">Enter</span></dt><dd>世界聊天</dd></div>
            <div><dt><span class="kbd">Tab</span></dt><dd>本局排行</dd></div>
            <div><dt><span class="kbd">M</span></dt><dd>全屏地图</dd></div>
            <div><dt><span class="kbd">G</span></dt><dd>脱离卡死（出现提示时）</dd></div>
            <div><dt><span class="kbd">R</span></dt><dd>回到南入口</dd></div>
            <div><dt><span class="kbd">Esc</span></dt><dd>暂停与设置</dd></div>
          </dl>
        </section>
      </div>
      <aside class="title-right">
        <div class="king-card" id="king-card" data-empty="true">
          <span class="king-crown"><svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16h20l1-11-6 5-5-9-5 9-6-5z"/></svg></span>
          <span class="king-label">当前淘汰王</span>
          <b class="king-name" id="king-name">虚位以待</b>
          <span class="king-kills" id="king-kills">注册并淘汰对手，成为第一位淘汰王</span>
        </div>
      </aside>
    </div>
    <footer class="title-bottom">
      <div class="loading-strip">
        <ol class="stages" aria-label="加载进度"></ol>
        <span class="stage-label" id="stage-label">正在准备…</span>
      </div>
      <p class="load-error" id="load-error" role="alert" hidden></p>
      <button class="secondary" id="reload-button" type="button" hidden>重新加载</button>
      <button class="play-button" id="enter-button" type="button" disabled><span class="play-label" id="enter-label">正在加载</span><small aria-hidden="true">ENTER THE ARENA</small></button>
      <p class="fine-print">账号只保存用户名、加密后的密码和战绩，不收集其他个人信息 · 场景由 FF-01 平面图推导，并非实地测量</p>
    </footer>
  </section>

  <section class="screen screen-hud" aria-label="游戏界面">
    <div class="location" id="location" aria-live="polite">
      <span class="stripe" aria-hidden="true"></span>
      <span class="location-code" id="location-code">—</span>
      <span class="location-name" id="location-name">正在定位</span>
      <span class="location-kind" id="location-kind"></span>
    </div>
    <div class="round-bar" id="round-bar" data-tone="neutral">
      <span class="round-clock" id="round-clock">--:--</span>
      <span class="round-gold"><i class="gold-dot" aria-hidden="true"></i><span id="round-gold">金飞盘</span></span>
    </div>
    <div class="gold-marker" id="gold-marker" hidden aria-hidden="true">
      <span class="gold-marker-arrow"></span><span class="gold-marker-icon"></span><span class="gold-marker-label" id="gold-marker-label"></span>
    </div>
    <div class="detention" id="detention" hidden>
      <strong>纪老师：室内不准打飞盘！</strong>
      <span id="detention-detail">罚站 4.0 秒</span>
      <i class="detention-bar"><i id="detention-fill"></i></i>
    </div>
    <div class="round-end" id="round-end" hidden>
      <small id="round-end-kicker">本局结束</small>
      <strong id="round-end-title"></strong>
      <span id="round-end-detail"></span>
    </div>
    <div class="spectate" id="spectate" hidden><strong>观战中</strong><span id="spectate-detail"></span><small>点击左键切换观看对象</small></div>
    <span class="latency" id="latency" data-quality="none">离线</span>
    <div class="ammo" id="ammo" data-empty="false" aria-label="飞盘"><span class="ammo-icons" id="ammo-icons"></span><span id="ammo-text">练习 · 不限</span></div>
    <p class="watch-warning" id="watch-warning" hidden><b>纪老师在附近</b>禁止打飞盘</p>
    <p class="radar" id="radar" hidden>监控画面 · <b id="radar-seconds">30</b> 秒</p>
    <div class="gold-kill" id="gold-kill" hidden>
      <small>金飞盘击杀</small>
      <strong><b id="gold-kill-by"></b><i aria-hidden="true"></i><b id="gold-kill-target"></b></strong>
    </div>
    <section class="leaderboard" id="leaderboard" aria-label="本局淘汰数">
      <div class="king-line" id="king-line" hidden><span class="king-crown"><svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16h20l1-11-6 5-5-9-5 9-6-5z"/></svg></span><span>淘汰王</span><b id="king-line-name"></b><em id="king-line-kills"></em></div>
      <header><span>本局淘汰数</span><span class="net-status" id="net-status" data-state="offline">离线练习</span></header>
      <ol id="leaderboard-rows"></ol>
    </section>
    <div class="scope" id="scope" aria-hidden="true" data-ready="false">
      <div class="scope-vignette"></div>
      <svg class="scope-reticle" viewBox="-100 -100 200 200">
        <circle class="scope-ring" r="62" pathLength="100" />
        <circle class="scope-progress" r="62" pathLength="100" />
        <path class="scope-cross" d="M-96 0H-14M14 0H96M0 -96V-14M0 14V96" />
        <path class="scope-ticks" d="M-50 -4V4M-34 -3V3M50 -4V4M34 -3V3M-4 34H4M-3 50H3" />
        <circle class="scope-dot" r="2.2" />
      </svg>
      <p class="scope-label"><span class="scope-state" id="scope-state">瞄准中</span><small>右键取消</small></p>
    </div>
    <span class="crosshair" aria-hidden="true"></span>
    <span class="charge" id="charge" aria-hidden="true" hidden></span>
    <span class="hitmarker" id="hitmarker" aria-hidden="true"></span>
    <span class="popup" id="popup" aria-hidden="true"></span>
    <p class="interaction" id="interaction" hidden></p>
    <div class="chat" id="chat" data-open="false">
      <ol class="chat-log" id="chat-log" aria-live="polite"></ol>
      <form class="chat-form" id="chat-form" hidden><span>全服</span><input id="chat-input" type="text" maxlength="120" autocomplete="off" placeholder="输入消息，Enter 发送，Esc 取消" /></form>
      <p class="chat-hint" id="chat-hint"><span class="kbd">Enter</span> 聊天</p>
    </div>
    <div class="damage" id="damage" aria-hidden="true"></div>
    <span class="damage-dir" id="damage-dir" aria-hidden="true"></span>
    <div class="name-tags" id="name-tags" aria-hidden="true"></div>
    <p class="broadcast" id="broadcast" aria-live="assertive" hidden></p>
    <div class="health" id="health" aria-label="生命"></div>
    <button class="unstuck" id="unstuck" type="button" hidden><span class="kbd">G</span>好像卡住了？脱离卡死</button>
    <ol class="feed" id="feed" aria-live="polite"></ol>
    <div class="scoreboard" id="scoreboard" hidden>
      <table><thead><tr><th>玩家</th><th>淘汰数</th><th>被淘汰</th></tr></thead><tbody id="scoreboard-rows"></tbody></table>
    </div>
    <div class="eliminated" id="eliminated" hidden><strong id="eliminated-title"></strong><span id="eliminated-detail"></span></div>
    <div class="map-dock">
      <canvas id="minimap" width="150" height="150" aria-label="小地图，北方朝上"></canvas>
    </div>
    <div class="hints" aria-hidden="true">
      <span><span class="kbd">左键</span>飞盘</span>
      <span><span class="kbd">F</span>检视</span>
      <span><span class="kbd">Tab</span>排行</span>
      <span><span class="kbd">M</span>地图</span>
      <span><span class="kbd">Esc</span>暂停</span>
    </div>
    <p class="toast" id="toast" role="status" hidden></p>
    <div class="full-map" aria-label="全屏地图">
      <div><canvas id="full-map"></canvas><p>配 配电室 · 监 监控室 · 体 体育办公室 · 按 M 关闭地图</p></div>
    </div>
  </section>

  <div class="update-dialog" id="update-dialog" role="alertdialog" aria-labelledby="update-title" hidden>
    <div class="update-card">
      <span class="update-badge">新版本</span>
      <h2 id="update-title">游戏已更新</h2>
      <p id="update-detail">刷新页面即可使用最新版本。你的设置和登录状态都保存在本机，不会丢失。</p>
      <div class="update-actions">
        <button class="primary" id="update-reload" type="button">立即刷新</button>
        <button class="secondary" id="update-later" type="button">稍后</button>
      </div>
    </div>
  </div>

  <section class="screen screen-pause" aria-labelledby="pause-heading">
    <div class="pause-column">
      <h2 id="pause-heading">已暂停</h2>
      <div class="pause-actions">
        <button class="primary" id="resume-button" type="button">继续游戏</button>
        <button class="secondary" id="recover-button" type="button">脱离卡死 · 回到南入口</button>
      </div>
      <fieldset>
        <legend>设置</legend>
        <label class="slider">鼠标灵敏度<output id="sensitivity-value"></output>
          <input id="sensitivity" type="range" /></label>
        <label class="slider">视野<output id="fov-value"></output>
          <input id="fov" type="range" /></label>
      </fieldset>
      <fieldset>
        <legend>战斗反馈</legend>
        <label class="slider">镜头动态
          <select id="camera-motion"><option value="off">关闭</option><option value="low">低</option><option value="normal">标准</option></select></label>
        <label class="slider">特效强度
          <select id="effects-quality"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        <label class="check-row"><input id="reduced-flashes" type="checkbox" />减少闪光</label>
      </fieldset>
      <fieldset>
        <legend>音量</legend>
        <label class="slider">总音量<output id="master-volume-value"></output>
          <input id="master-volume" type="range" /></label>
        <label class="slider">战斗音量<output id="combat-volume-value"></output>
          <input id="combat-volume" type="range" /></label>
        <label class="slider">确认音量<output id="confirmation-volume-value"></output>
          <input id="confirmation-volume" type="range" /></label>
      </fieldset>
    </div>
  </section>
</div>`;

const describe = (location: CampusRoom | undefined) => {
    if (!location)
        return { code: '—', name: '走廊与公共区', kind: '这里没有标注房间', colour: undefined, unmapped: true };
    const shortCode = location.id.length <= 7 && /\d/.test(location.id);
    return {
        code: shortCode ? location.id : location.name,
        name: shortCode ? location.name : location.id,
        kind: location.kindLabel || KIND_FALLBACK_LABEL[location.kind] || '',
        colour: KIND_STRIPE[location.kind],
        unmapped: !shortCode
    };
};

/**
 * Restarts an element's CSS animation without forcing a synchronous layout (reading offsetWidth mid-frame stalls
 * the game loop): running animations are rewound; otherwise the class is re-added on the next frame.
 */
const replay = (element: HTMLElement, className: string) => {
    if (element.classList.contains(className)) {
        const running = element.getAnimations();
        if (running.length) {
            for (const animation of running) {
                animation.cancel();
                animation.play();
            }
            return;
        }
        element.classList.remove(className);
        requestAnimationFrame(() => element.classList.add(className));
        return;
    }
    element.classList.add(className);
};

export const createUi = () => {
    document.body.insertAdjacentHTML('beforeend', MARKUP);
    const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
    let executeAction: (() => void) | null = null;
    $('#execute-button').addEventListener('click', () => executeAction?.());
    $('#execute-button').addEventListener('mousedown', (event) => event.stopPropagation());
    const root = $('#app-ui');
    const stagesList = $<HTMLOListElement>('.stages');
    for (const [stage, label] of STAGES) {
        const item = document.createElement('li');
        item.dataset.stage = stage;
        item.dataset.state = 'pending';
        item.textContent = label;
        stagesList.append(item);
    }
    const enterButton = $<HTMLButtonElement>('#enter-button');
    const toast = $<HTMLParagraphElement>('#toast');
    const map = createMapRenderer($<HTMLCanvasElement>('#minimap'), $<HTMLCanvasElement>('#full-map'));
    let toastTimer = 0;
    let broadcastTimer = 0;

    const setScreen = (screen: 'loading' | 'ready' | 'play' | 'paused' | 'error') => (root.dataset.screen = screen);

    // ---------- title: tabs, identity, board ----------
    let signedIn = false;
    const scopeShown = { aim: -1, ready: false };
    let goldKillTimer = 0;
    const authError = (message: string) => {
        const error = $('#auth-error');
        error.textContent = message;
        error.hidden = false;
    };
    const renderBoard = (board: BoardView) => {
        const rows = board.top.map((row, index) => {
            const tr = document.createElement('tr');
            if (board.king && row.name === board.king.name) tr.dataset.king = 'true';
            for (const value of [String(index + 1), row.name, String(row.kills), formatWinRate(row)]) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.append(td);
            }
            return tr;
        });
        if (!rows.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.textContent = '还没有注册玩家的战绩';
            tr.append(td);
            rows.push(tr);
        }
        $('#board-rows').replaceChildren(...rows);
    };
    const bindTitle = (actions: Actions) => {
        for (const tab of document.querySelectorAll<HTMLButtonElement>('.title-tabs button')) {
            tab.addEventListener('click', () => {
                for (const other of document.querySelectorAll<HTMLButtonElement>('.title-tabs button')) {
                    other.setAttribute('aria-selected', String(other === tab));
                }
                for (const panel of document.querySelectorAll<HTMLElement>('.tab-panel')) {
                    panel.hidden = panel.dataset.panel !== tab.dataset.tab;
                }
                if (tab.dataset.tab === 'board') {
                    actions
                        .loadBoard()
                        .then(renderBoard)
                        .catch((error: Error) => {
                            const tr = document.createElement('tr');
                            const td = document.createElement('td');
                            td.colSpan = 5;
                            td.textContent = error.message;
                            tr.append(td);
                            $('#board-rows').replaceChildren(tr);
                        });
                }
            });
        }
        // Enter in either field starts the game (signing in or registering on the way).
        $<HTMLFormElement>('#auth-form').addEventListener('submit', (event) => {
            event.preventDefault();
            actions.enter();
        });
        $('#logout-button').addEventListener('click', () => void actions.logout());
    };

    // ---------- HUD: world chat ----------
    const chatLog = $<HTMLOListElement>('#chat-log');
    const appendChat = (line: { name: string; colour: number; text: string; system?: true }) => {
        const item = document.createElement('li');
        if (line.system) item.dataset.system = 'true';
        const who = document.createElement('b');
        who.textContent = line.system ? '系统' : line.name;
        who.style.setProperty('--player-colour', `hsl(${line.colour} 75% 60%)`);
        item.append(who, document.createTextNode(line.text));
        chatLog.append(item);
        while (chatLog.children.length > 40) chatLog.firstElementChild!.remove();
        // Scroll on the next frame so appending a line never forces a layout mid-frame.
        requestAnimationFrame(() => (chatLog.scrollTop = chatLog.scrollHeight));
        // Fresh lines show briefly during play; the full log shows while typing.
        window.setTimeout(() => (item.dataset.old = 'true'), 9000);
    };

    const showToast = (message: string, tone: 'info' | 'notice' = 'info', duration = 3600) => {
        toast.textContent = message;
        toast.dataset.tone = tone;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => (toast.hidden = true), duration);
    };

    const bindSlider = (
        id: string,
        range: { min: number; max: number; step: number },
        value: number,
        format: (value: number) => string,
        onInput: (value: number) => void
    ) => {
        const input = $<HTMLInputElement>(`#${id}`);
        const output = $<HTMLOutputElement>(`#${id}-value`);
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
        input.value = String(value);
        output.textContent = format(value);
        input.addEventListener('input', () => {
            output.textContent = format(Number(input.value));
            onInput(Number(input.value));
        });
    };

    return {
        stage: (stage: LoadStage, state: 'active' | 'done') => {
            const item = stagesList.querySelector<HTMLElement>(`[data-stage="${stage}"]`);
            if (item) item.dataset.state = state;
            if (state === 'active') $('#stage-label').textContent = `正在加载${item?.textContent ?? ''}…`;
        },
        ready: (actions: Actions, settings: Settings) => {
            for (const item of stagesList.querySelectorAll<HTMLElement>('li')) item.dataset.state = 'done';
            $('#stage-label').textContent = '准备就绪';
            enterButton.disabled = false;
            $('#enter-label').textContent = '进入校园';
            enterButton.addEventListener('click', actions.enter);
            bindTitle(actions);
            $('#resume-button').addEventListener('click', actions.enter);
            $('#recover-button').addEventListener('click', actions.recover);
            const current = { ...settings };
            root.dataset.reducedFlashes = String(current.reducedFlashes);
            bindSlider(
                'sensitivity',
                SETTING_RANGES.lookSensitivity,
                settings.lookSensitivity,
                (v) => `${Math.round((v / 0.08) * 100)}%`,
                (v) => {
                    current.lookSensitivity = v;
                    actions.settingsChanged({ ...current });
                }
            );
            bindSlider(
                'fov',
                SETTING_RANGES.fieldOfView,
                settings.fieldOfView,
                (v) => `${v}°`,
                (v) => {
                    current.fieldOfView = v;
                    actions.settingsChanged({ ...current });
                }
            );
            bindSlider('master-volume', { min: 0, max: 1, step: 0.01 }, settings.masterVolume, (v) => `${Math.round(v * 100)}%`, (v) => {
                current.masterVolume = v;
                actions.settingsChanged({ ...current });
            });
            bindSlider('combat-volume', { min: 0, max: 1, step: 0.01 }, settings.combatVolume, (v) => `${Math.round(v * 100)}%`, (v) => {
                current.combatVolume = v;
                actions.settingsChanged({ ...current });
            });
            bindSlider('confirmation-volume', { min: 0, max: 1, step: 0.01 }, settings.confirmationVolume, (v) => `${Math.round(v * 100)}%`, (v) => {
                current.confirmationVolume = v;
                actions.settingsChanged({ ...current });
            });
            const cameraMotion = $<HTMLSelectElement>('#camera-motion');
            cameraMotion.value = settings.cameraMotion;
            cameraMotion.addEventListener('change', () => {
                current.cameraMotion = cameraMotion.value as Settings['cameraMotion'];
                actions.settingsChanged({ ...current });
            });
            const effectsQuality = $<HTMLSelectElement>('#effects-quality');
            effectsQuality.value = settings.effectsQuality;
            effectsQuality.addEventListener('change', () => {
                current.effectsQuality = effectsQuality.value as Settings['effectsQuality'];
                actions.settingsChanged({ ...current });
            });
            const reducedFlashes = $<HTMLInputElement>('#reduced-flashes');
            reducedFlashes.checked = settings.reducedFlashes;
            reducedFlashes.addEventListener('change', () => {
                current.reducedFlashes = reducedFlashes.checked;
                root.dataset.reducedFlashes = String(current.reducedFlashes);
                actions.settingsChanged({ ...current });
            });
            setScreen('ready');
            const needsSignIn = !signedIn && $('#operator').dataset.accounts !== 'false';
            (needsSignIn ? $('#auth-name') : enterButton).focus();
        },
        playing: () => setScreen('play'),
        paused: () => {
            root.dataset.map = 'closed';
            setScreen('paused');
            $('#resume-button').focus();
        },
        showError: (message: string) => {
            const error = $<HTMLParagraphElement>('#load-error');
            error.textContent = `${message}。请检查网络或本地资源是否完整，然后重新加载。`;
            error.hidden = false;
            enterButton.hidden = true;
            const reload = $<HTMLButtonElement>('#reload-button');
            reload.hidden = false;
            reload.onclick = () => window.location.reload();
            setScreen('error');
        },
        setLocation: (location: CampusRoom | undefined) => {
            const plate = $('#location');
            const info = describe(location);
            $('#location-code').textContent = info.code;
            $('#location-name').textContent = info.name;
            const kind = $('#location-kind');
            kind.textContent = info.kind;
            plate.dataset.unmapped = String(info.unmapped);
            plate.dataset.corridor = String(!location);
            if (info.colour) plate.style.setProperty('--kind-colour', info.colour);
            else plate.style.removeProperty('--kind-colour');
        },
        notify: (message: string) => showToast(message),
        toggleMap: () => {
            if (root.dataset.screen !== 'play') return;
            root.dataset.map = root.dataset.map === 'open' ? 'closed' : 'open';
        },
        drawMaps: (x: number, z: number, forwardX: number, forwardZ: number, markers: MapMarkers) =>
            map.draw(x, z, forwardX, forwardZ, root.dataset.map === 'open', markers),
        /** Round countdown (seconds left), or null when there is no round (offline practice). */
        roundClock: (seconds: number | null) => {
            const text =
                seconds === null
                    ? '练习'
                    : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
            const clock = $('#round-clock');
            if (clock.textContent !== text) clock.textContent = text;
            const urgent = seconds !== null && seconds <= 30;
            if (clock.dataset.urgent !== String(urgent)) clock.dataset.urgent = String(urgent);
        },
        /** Golden disc status line under the clock. */
        goldStatus: (text: string, tone: 'neutral' | 'mine' | 'other' | 'lying') => {
            const status = $('#round-gold');
            if (status.textContent !== text) status.textContent = text;
            $('#round-bar').dataset.tone = tone;
            root.dataset.gold = tone;
        },
        /**
         * The golden disc's on-screen marker: at its screen position when in view, otherwise pinned to the screen edge
         * with an arrow pointing toward it. Null hides it (when you carry it yourself).
         */
        goldMarker: (marker: { x: number; y: number; angle: number | null; label: string } | null) => {
            const element = $('#gold-marker');
            element.hidden = marker === null;
            if (!marker) return;
            element.style.transform = `translate(${Math.round(marker.x)}px, ${Math.round(marker.y)}px)`;
            element.dataset.edge = String(marker.angle !== null);
            if (marker.angle !== null) element.style.setProperty('--angle', `${Math.round(marker.angle)}deg`);
            const label = $('#gold-marker-label');
            if (label.textContent !== marker.label) label.textContent = marker.label;
        },
        /** Standing-still penalty from 纪老师: seconds left (null hides). */
        detention: (seconds: number | null, total = 4) => {
            const element = $('#detention');
            element.hidden = seconds === null;
            if (seconds === null) return;
            $('#detention-detail').textContent = `罚站中 · ${seconds.toFixed(1)} 秒后可以移动`;
            $('#detention-fill').style.width = `${(seconds / total) * 100}%`;
        },
        /** End-of-round banner (null hides it). */
        roundEnd: (result: { winner: string | null; mine: boolean; nextIn: number } | null) => {
            const element = $('#round-end');
            element.hidden = result === null;
            if (!result) return;
            element.dataset.mine = String(result.mine);
            $('#round-end-title').textContent = result.mine
                ? '你赢得了本局！'
                : result.winner
                  ? `${result.winner} 赢得本局`
                  : '本局无人守住金飞盘';
            $('#round-end-detail').textContent = `${Math.ceil(result.nextIn)} 秒后开始新一局 · 金飞盘将重新刷新`;
        },
        /** Watching mode (out for the round): who is being watched, or why; null hides it. */
        spectate: (state: { reason: string | null; watching: string | null } | null) => {
            const element = $('#spectate');
            element.hidden = state === null;
            if (!state) return;
            const text = state.watching ? `正在观看 ${state.watching}` : (state.reason ?? '');
            const detail = $('#spectate-detail');
            if (detail.textContent !== text) detail.textContent = text;
        },
        /** Round-trip time to the room, bottom left (null when offline). */
        latency: (ms: number | null) => {
            const element = $('#latency');
            element.textContent = ms === null ? '离线' : `${ms} ms`;
            element.dataset.quality = ms === null ? 'none' : ms < 80 ? 'good' : ms < 160 ? 'fair' : 'poor';
        },
        /** Username and password typed on the title screen. */
        credentials: () => ({
            name: $<HTMLInputElement>('#auth-name').value.trim(),
            password: $<HTMLInputElement>('#auth-password').value
        }),
        /** Shows a sign-in problem under the form (null clears it). */
        authError: (message: string | null) => {
            if (message === null) $('#auth-error').hidden = true;
            else authError(message);
        },
        /** Busy state of the play button while signing in. */
        signingIn: (busy: boolean) => {
            enterButton.disabled = busy;
            $('#enter-label').textContent = busy ? '正在登录…' : '进入校园';
        },
        nameTagLayer: () => $('#name-tags'),
        /** Title status line before joining (online count from the server, or offline). */
        titleStatus: (online: number | null) => {
            const title = $('#title-status');
            title.dataset.state = online === null ? 'offline' : 'online';
            $('#title-online').textContent = online === null ? '离线练习' : `服务器在线 · ${online} 人`;
        },
        /** Signed-in account (title card), or null when signed out. */
        account: (account: AccountView | null) => {
            signedIn = !!account;
            $('#operator').dataset.mode = signedIn ? 'signed' : 'form';
            if (account) {
                $('#auth-error').hidden = true;
                $<HTMLInputElement>('#auth-password').value = '';
                $('#account-name').textContent = account.name;
                $('#account-kills').textContent = String(account.kills);
                $('#account-win-rate').textContent = formatWinRate(account);
                $('#account-deaths').textContent = String(account.deaths);
                $('#account-rounds').textContent = String(account.rounds ?? 0);
            }
        },
        /** Whether account features are available (a server is configured). */
        accountsAvailable: (available: boolean) => {
            $('#operator').dataset.accounts = String(available);
            if (!available) $('#operator-hint').textContent = '离线练习模式：无需登录，直接进入。';
        },
        /** The standing 淘汰王 (title card and HUD), shown whether or not they are online. */
        king: (king: KingView | null, isNew = false) => {
            const card = $('#king-card');
            card.dataset.empty = String(!king);
            $('#king-name').textContent = king ? king.name : '虚位以待';
            $('#king-kills').textContent = king
                ? `累计淘汰 ${king.kills} · ${new Date(king.since).toLocaleDateString('zh-CN')} 登基`
                : '注册并淘汰对手，成为第一位淘汰王';
            const line = $('#king-line');
            line.hidden = !king;
            if (king) {
                $('#king-line-name').textContent = king.name;
                $('#king-line-kills').textContent = `${king.kills} 淘汰`;
                if (isNew) {
                    replay(line, 'new');
                }
            }
        },
        chatHistory: (lines: { name: string; colour: number; text: string; system?: true }[]) => {
            chatLog.replaceChildren();
            for (const line of lines) appendChat(line);
            for (const item of chatLog.querySelectorAll<HTMLElement>('li')) item.dataset.old = 'true';
        },
        chatLine: appendChat,
        /** Opens the chat input; `send` receives the text on Enter. Returns false when chat is unavailable. */
        openChat: (send: (text: string) => void, onClose: () => void) => {
            const chat = $('#chat');
            const form = $<HTMLFormElement>('#chat-form');
            const input = $<HTMLInputElement>('#chat-input');
            chat.dataset.open = 'true';
            form.hidden = false;
            input.value = '';
            input.focus();
            const close = () => {
                chat.dataset.open = 'false';
                form.hidden = true;
                input.blur();
                form.onsubmit = null;
                input.onkeydown = null;
                onClose();
            };
            form.onsubmit = (event) => {
                event.preventDefault();
                const text = input.value.trim();
                if (text) send(text);
                close();
            };
            input.onkeydown = (event) => {
                event.stopPropagation();
                if (event.key === 'Escape') close();
            };
            return close;
        },
        chatOpen: () => $('#chat').dataset.open === 'true',
        /** Short text by the crosshair: hit, head hit, elimination, or being head-hit. */
        popup: (text: string, kind: 'hit' | 'head' | 'kill' | 'snipe' | 'gold' | 'me') => {
            const popup = $('#popup');
            popup.textContent = text;
            popup.dataset.kind = kind;
            replay(popup, 'show');
        },
        /**
         * Offers a reload for a newer version. Shown as a dialog; during play (mouse captured) it waits on the
         * pause screen and a light notice says so.
         */
        updateAvailable: (detail?: string) => {
            const dialog = $('#update-dialog');
            if (detail) $('#update-detail').textContent = detail;
            $('#update-reload').onclick = () => window.location.reload();
            $('#update-later').onclick = () => {
                dialog.hidden = true;
                root.dataset.update = 'later';
            };
            root.dataset.update = 'available';
            dialog.hidden = false;
            if (root.dataset.screen === 'play') showToast('游戏有新版本：按 Esc 后刷新即可更新', 'notice', 8000);
        },
        /** Shows or hides the escape offer when the player seems stuck. */
        stuck: (show: boolean, onEscape?: () => void) => {
            const button = $<HTMLButtonElement>('#unstuck');
            if (onEscape) button.onclick = onEscape;
            button.hidden = !show;
        },
        net: (state: 'offline' | 'connecting' | 'online' | 'rejected', players: number) => {
            const title = $('#title-status');
            title.dataset.state = state;
            $('#title-online').textContent =
                state === 'online' ? `在线 ${players} 人` : state === 'connecting' ? '连接中…' : '离线';
            const status = $('#net-status');
            status.dataset.state = state;
            status.textContent =
                state === 'online'
                    ? `在线 ${players} 人`
                    : state === 'connecting'
                      ? '连接中…'
                      : state === 'rejected'
                        ? '无法加入 · 离线'
                        : '离线练习';
        },
        /** Live score list (top left): the top five, plus your own row when you are further down. */
        leaderboard: (
            rows: {
                name: string;
                kills: number;
                hp: number;
                alive: boolean;
                colour: number;
                me: boolean;
                king: boolean;
            }[]
        ) => {
            const sorted = [...rows].sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name));
            const shown = sorted.slice(0, 5);
            const mine = sorted.findIndex((row) => row.me);
            if (mine >= 5) shown.push(sorted[mine]);
            $('#leaderboard-rows').replaceChildren(
                ...shown.map((row) => {
                    const item = document.createElement('li');
                    item.style.setProperty('--player-colour', `hsl(${row.colour} 75% 52%)`);
                    if (row.me) item.dataset.me = 'true';
                    if (!row.alive) item.dataset.out = 'true';
                    const rank = document.createElement('span');
                    rank.className = 'rank';
                    rank.textContent = String(sorted.indexOf(row) + 1);
                    const name = document.createElement('span');
                    name.className = 'who';
                    // The standing 淘汰王 (all-time record holder, not this round's leader) carries the title.
                    if (row.king) {
                        item.dataset.leader = 'true';
                        const title = document.createElement('b');
                        title.className = 'title';
                        title.textContent = '淘汰王';
                        name.append(title);
                    }
                    name.append(row.name);
                    const score = document.createElement('b');
                    score.textContent = String(row.kills);
                    item.append(rank, name, score);
                    return item;
                })
            );
        },
        health: (hp: number, max: number) => {
            const health = $('#health');
            health.replaceChildren(
                ...Array.from({ length: max }, (_, index) => {
                    const pip = document.createElement('span');
                    if (index < hp) pip.dataset.full = 'true';
                    return pip;
                })
            );
            health.dataset.low = String(hp <= 1);
        },
        hitPrediction: (throwId: number) => {
            const marker = $('#hitmarker');
            marker.dataset.prediction = String(throwId);
            marker.dataset.kind = 'predicted';
            replay(marker, 'show');
        },
        rejectHitPrediction: (throwId: number) => {
            const marker = $('#hitmarker');
            if (marker.dataset.prediction !== String(throwId)) return;
            delete marker.dataset.prediction;
            delete marker.dataset.kind;
            marker.classList.remove('show');
        },
        hitMarker: (kind: 'hit' | 'head' | 'kill' | 'snipe') => {
            const marker = $('#hitmarker');
            delete marker.dataset.prediction;
            marker.dataset.kind = kind;
            replay(marker, 'show');
        },
        interaction: (text: string | null) => {
            const prompt = $('#interaction');
            prompt.hidden = text === null;
            if (text !== null && prompt.textContent !== text) prompt.textContent = text;
        },
        onExecute: (action: () => void) => {
            executeAction = action;
        },
        executionPrompt: (name: string | null) => {
            $('#execute-button').hidden = name === null;
            if (name !== null && $('#execute-target').textContent !== name) $('#execute-target').textContent = name;
        },
        executionState: (text: string | null, progress: number) => {
            $('#app-ui').dataset.executing = String(text !== null);
            $('#execution-banner').hidden = text === null;
            if (text !== null && $('#execution-label').textContent !== text) $('#execution-label').textContent = text;
            $('#execution-progress').style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
        },
        /** Red flash, plus an arc around the crosshair pointing toward the thrower (degrees, 0 = ahead, clockwise). */
        damage: (fromAngle: number | null = null) => {
            const damage = $('#damage');
            replay(damage, 'show');
            if (fromAngle === null) return;
            const arc = $('#damage-dir');
            arc.style.setProperty('--angle', `${fromAngle}deg`);
            replay(arc, 'show');
        },
        /** Elimination broadcast across the upper centre of the screen. */
        broadcast: (killer: string, victim: string, tone: 'neutral' | 'mine' | 'me', streak = 1, snipe = false) => {
            const banner = $('#broadcast');
            banner.dataset.tone = tone;
            banner.dataset.snipe = String(snipe);
            const a = document.createElement('b');
            a.textContent = killer;
            const b = document.createElement('b');
            b.textContent = victim;
            banner.replaceChildren(a, document.createTextNode(snipe ? ' 狙击爆头 ' : ' 淘汰了 '), b);
            if (streak > 1) {
                const tag = document.createElement('span');
                tag.className = 'streak';
                tag.textContent = streak >= 3 ? `${streak} 连淘汰！` : '双杀';
                banner.append(tag);
            }
            banner.hidden = false;
            replay(banner, 'show');
            window.clearTimeout(broadcastTimer);
            broadcastTimer = window.setTimeout(() => (banner.hidden = true), 2600);
        },
        /** Discs in hand (null: offline practice, unlimited). */
        ammo: (count: number | null, max: number) => {
            const element = $('#ammo');
            element.dataset.empty = String(count === 0);
            $('#ammo-text').textContent =
                count === null
                    ? '练习 · 不限'
                    : count === 0
                      ? '没有飞盘 · 去捡回或到体育组办公室'
                      : `飞盘 ${count}/${max}`;
            const icons = $('#ammo-icons');
            icons.replaceChildren(
                ...Array.from({ length: count === null ? 0 : max }, (_, index) => {
                    const icon = document.createElement('i');
                    icon.dataset.full = String(count !== null && index < count);
                    return icon;
                })
            );
        },
        /** 纪老师's circle: a standing warning while you are inside it. */
        watchWarning: (show: boolean) => {
            $('#watch-warning').hidden = !show;
        },
        /** Monitoring room radar: seconds left (null hides). */
        radar: (seconds: number | null) => {
            $('#radar').hidden = seconds === null;
            if (seconds !== null) $('#radar-seconds').textContent = String(Math.ceil(seconds));
        },
        /** The golden disc took someone out: a big gold kill banner. */
        goldKill: (killer: string, victim: string, tone: 'neutral' | 'mine' | 'me') => {
            const banner = $('#gold-kill');
            banner.dataset.tone = tone;
            $('#gold-kill-by').textContent = killer;
            $('#gold-kill-target').textContent = victim;
            banner.hidden = false;
            replay(banner, 'show');
            window.clearTimeout(goldKillTimer);
            goldKillTimer = window.setTimeout(() => (banner.hidden = true), 3200);
        },
        /** A one-line announcement in the broadcast banner (round results and similar). */
        broadcastText: (text: string) => {
            const banner = $('#broadcast');
            banner.dataset.tone = 'mine';
            banner.dataset.snipe = 'false';
            banner.textContent = text;
            banner.hidden = false;
            replay(banner, 'show');
            window.clearTimeout(broadcastTimer);
            broadcastTimer = window.setTimeout(() => (banner.hidden = true), 4000);
        },
        /** The crosshair jumps and flashes on a confirmed hit. */
        crosshairKick: (kind: 'hit' | 'head' | 'kill') => {
            const crosshair = $('.crosshair');
            crosshair.dataset.kick = kind;
            replay(crosshair, 'kick');
        },
        /** Sniper scope overlay: aim progress 0–1 (0 hides it) and whether the next release is a sniper throw. */
        scope: (aim: number, ready: boolean) => {
            const value = Math.round(aim * 100) / 100;
            if (value === scopeShown.aim && ready === scopeShown.ready) return;
            scopeShown.aim = value;
            scopeShown.ready = ready;
            const scope = $('#scope');
            scope.style.setProperty('--aim', String(value));
            scope.dataset.ready = String(ready);
            root.dataset.aiming = String(value > 0.05);
            $('#scope-state').textContent = ready ? '狙击就绪 · 爆头一击必杀' : '瞄准中';
        },
        /** Throw charge 0..1 around the crosshair, or null to hide. */
        charge: (fraction: number | null) => {
            const charge = $('#charge');
            charge.hidden = fraction === null;
            if (fraction !== null) charge.style.setProperty('--charge', String(fraction));
        },
        feed: (text: string, tone: 'neutral' | 'mine' | 'me' = 'neutral') => {
            const list = $('#feed');
            const item = document.createElement('li');
            item.dataset.tone = tone;
            item.textContent = text;
            list.prepend(item);
            while (list.children.length > 5) list.lastElementChild!.remove();
            window.setTimeout(() => item.remove(), 6000);
        },
        scoreboard: (rows: { name: string; kills: number; deaths: number; me: boolean }[] | null) => {
            const board = $('#scoreboard');
            board.hidden = rows === null;
            if (!rows) return;
            $('#scoreboard-rows').replaceChildren(
                ...rows.map((row) => {
                    const tr = document.createElement('tr');
                    if (row.me) tr.dataset.me = 'true';
                    for (const value of [row.name, String(row.kills), String(row.deaths)]) {
                        const td = document.createElement('td');
                        td.textContent = value;
                        tr.append(td);
                    }
                    return tr;
                })
            );
        },
        eliminated: (by: string | null, seconds = 0) => {
            const overlay = $('#eliminated');
            overlay.hidden = by === null;
            if (by === null) return;
            $('#eliminated-title').textContent = `被 ${by} 的飞盘击中`;
            $('#eliminated-detail').textContent = `${seconds.toFixed(1)} 秒后复活`;
        }
    };
};

export type Ui = ReturnType<typeof createUi>;
