import type { CampusRoom } from '../world/roomIndex';

import { KIND_FALLBACK_LABEL, KIND_STRIPE } from './kinds';
import { createMapRenderer } from './minimap';
import type { Settings } from './settings';
import { SETTING_RANGES } from './settings';
import './theme.css';

export type LoadStage = 'physics' | 'campus' | 'structure' | 'dressing';
const STAGES: [LoadStage, string][] = [
    ['physics', '物理引擎'],
    ['campus', '校园模型与房间数据'],
    ['structure', '墙体、门洞与碰撞'],
    ['dressing', '家具、灯光与地图']
];

type Actions = {
    enter: () => void;
    recover: () => void;
    settingsChanged: (settings: Settings) => void;
};

const MARKUP = `
<div id="app-ui" data-screen="loading" data-map="closed">
  <section class="screen screen-title" aria-labelledby="title-heading">
    <div class="plan" aria-hidden="true"></div>
    <div class="title-shade" aria-hidden="true"></div>
    <header class="title-top">
      <span class="brand-mark">FF-01</span>
      <span class="brand-name">MOONSHOT ACADEMY · 校园一层</span>
      <span class="title-mode"><i aria-hidden="true"></i>多人在线 · 全服同一张地图</span>
    </header>
    <div class="title-main">
      <p class="eyebrow">开放世界 · 飞盘大乱斗</p>
      <h1 id="title-heading">Moonshot<br />Open World</h1>
      <p class="tagline">走遍校园一层的每一个房间，拿起飞盘和在线的所有人同场对战：两次命中即淘汰。</p>
      <div class="start-card">
        <div class="loading-strip">
          <ol class="stages" aria-label="加载进度"></ol>
          <span class="stage-label" id="stage-label">正在准备…</span>
        </div>
        <div class="start-row">
          <label class="nickname" for="nickname"><span>昵称</span><input id="nickname" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="不填则随机" /></label>
          <button class="primary" id="enter-button" type="button" disabled>正在加载</button>
        </div>
        <p class="load-error" id="load-error" role="alert" hidden></p>
        <button class="secondary" id="reload-button" type="button" hidden>重新加载</button>
      </div>
    </div>
    <footer class="title-bottom">
      <dl class="controls">
        <div><dt><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span></dt><dd>移动</dd></div>
        <div><dt><span class="kbd">Shift</span></dt><dd>冲刺</dd></div>
        <div><dt><span class="kbd">空格</span></dt><dd>跳跃</dd></div>
        <div><dt><span class="kbd">左键</span></dt><dd>按住蓄力，松开投掷</dd></div>
        <div><dt><span class="kbd">Tab</span></dt><dd>排行榜</dd></div>
        <div><dt><span class="kbd">M</span></dt><dd>地图</dd></div>
        <div><dt><span class="kbd">R</span></dt><dd>回到南入口</dd></div>
        <div><dt><span class="kbd">Esc</span></dt><dd>暂停</dd></div>
      </dl>
      <p class="fine-print">只显示你填写的昵称，无需登录，不保存个人信息 · 场景由 FF-01 平面图推导，墙高、门、家具与灯光为游戏补充，并非实地测量</p>
    </footer>
  </section>

  <section class="screen screen-hud" aria-label="游戏界面">
    <div class="location" id="location" aria-live="polite">
      <span class="stripe" aria-hidden="true"></span>
      <span class="location-code" id="location-code">—</span>
      <span class="location-name" id="location-name">正在定位</span>
      <span class="location-kind" id="location-kind"></span>
    </div>
    <section class="leaderboard" id="leaderboard" aria-label="实时积分">
      <header><span>积分</span><span class="net-status" id="net-status" data-state="offline">离线练习</span></header>
      <ol id="leaderboard-rows"></ol>
    </section>
    <span class="crosshair" aria-hidden="true"></span>
    <span class="charge" id="charge" aria-hidden="true" hidden></span>
    <span class="hitmarker" id="hitmarker" aria-hidden="true"></span>
    <div class="damage" id="damage" aria-hidden="true"></div>
    <span class="damage-dir" id="damage-dir" aria-hidden="true"></span>
    <div class="name-tags" id="name-tags" aria-hidden="true"></div>
    <p class="broadcast" id="broadcast" aria-live="assertive" hidden></p>
    <div class="health" id="health" aria-label="生命"></div>
    <button class="unstuck" id="unstuck" type="button" hidden><span class="kbd">G</span>好像卡住了？脱离卡死</button>
    <ol class="feed" id="feed" aria-live="polite"></ol>
    <div class="scoreboard" id="scoreboard" hidden>
      <table><thead><tr><th>玩家</th><th>击中</th><th>被击中</th></tr></thead><tbody id="scoreboard-rows"></tbody></table>
    </div>
    <div class="eliminated" id="eliminated" hidden><strong id="eliminated-title"></strong><span id="eliminated-detail"></span></div>
    <div class="map-dock">
      <canvas id="minimap" width="150" height="150" aria-label="小地图，北方朝上"></canvas>
      <span class="tally" id="tally"></span>
    </div>
    <div class="hints" aria-hidden="true">
      <span><span class="kbd">左键</span>飞盘</span>
      <span><span class="kbd">Tab</span>排行</span>
      <span><span class="kbd">M</span>地图</span>
      <span><span class="kbd">Esc</span>暂停</span>
    </div>
    <p class="toast" id="toast" role="status" hidden></p>
    <div class="full-map" aria-label="全屏地图">
      <div><canvas id="full-map"></canvas><p>按 M 关闭地图。斜线覆盖的房间还没去过。</p></div>
    </div>
  </section>

  <div class="update-dialog" id="update-dialog" role="alertdialog" aria-labelledby="update-title" hidden>
    <div class="update-card">
      <span class="update-badge">新版本</span>
      <h2 id="update-title">游戏已更新</h2>
      <p id="update-detail">刷新页面即可使用最新版本。你的探索进度保存在本机，不会丢失。</p>
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
        <button class="primary" id="resume-button" type="button">继续探索</button>
        <button class="secondary" id="recover-button" type="button">脱离卡死 · 回到南入口</button>
      </div>
      <div class="progress">
        <span id="progress-label"></span>
        <div class="progress-bar" aria-hidden="true"><span id="progress-fill"></span></div>
        <ul class="recent" id="recent"></ul>
      </div>
      <fieldset>
        <legend>设置</legend>
        <label class="slider">鼠标灵敏度<output id="sensitivity-value"></output>
          <input id="sensitivity" type="range" /></label>
        <label class="slider">视野<output id="fov-value"></output>
          <input id="fov" type="range" /></label>
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

const NICKNAME_KEY = 'moonshot.nickname';

export const createUi = (locations: CampusRoom[]) => {
    document.body.insertAdjacentHTML('beforeend', MARKUP);
    const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
    try {
        $<HTMLInputElement>('#nickname').value = window.localStorage.getItem(NICKNAME_KEY) ?? '';
    } catch {
        /* storage unavailable */
    }
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
    const map = createMapRenderer($<HTMLCanvasElement>('#minimap'), $<HTMLCanvasElement>('#full-map'), locations);
    const byId = new Map(locations.map((location) => [location.id, location]));
    let toastTimer = 0;
    let broadcastTimer = 0;
    let discoveredIds: readonly string[] = [];

    const setScreen = (screen: 'loading' | 'ready' | 'play' | 'paused' | 'error') => (root.dataset.screen = screen);

    const showToast = (message: string, tone: 'info' | 'discovery' = 'info', duration = 3600) => {
        toast.textContent = message;
        toast.dataset.tone = tone;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => (toast.hidden = true), duration);
    };

    const renderProgress = (total: number) => {
        const count = discoveredIds.length;
        $('#tally').innerHTML = `已发现 <strong>${count}</strong> / ${total}`;
        $('#progress-label').textContent = `已发现 ${count} / ${total} 处地点`;
        $('#progress-fill').style.width = `${(count / Math.max(1, total)) * 100}%`;
        const recent = $('#recent');
        recent.replaceChildren(
            ...discoveredIds
                .slice(-5)
                .reverse()
                .map((id) => {
                    const item = document.createElement('li');
                    const code = document.createElement('b');
                    code.textContent = id;
                    item.append(code, ` ${byId.get(id)?.name ?? ''}`);
                    return item;
                })
        );
    };

    const bindSlider = (
        id: string,
        range: { min: number; max: number; step: number },
        value: number,
        format: (value: number) => string,
        onInput: (value: number) => void
    ) => {
        const input = $<HTMLInputElement>(`#${id}`);
        const output = $<HTMLOutputElement>(`#${id === 'fov' ? 'fov' : 'sensitivity'}-value`);
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
            enterButton.textContent = '进入校园';
            enterButton.addEventListener('click', actions.enter);
            $('#resume-button').addEventListener('click', actions.enter);
            $('#recover-button').addEventListener('click', actions.recover);
            const current = { ...settings };
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
            setScreen('ready');
            enterButton.focus();
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
        setLocation: (location: CampusRoom | undefined, isNew: boolean) => {
            const plate = $('#location');
            const info = describe(location);
            $('#location-code').textContent = info.code;
            $('#location-name').textContent = info.name;
            const kind = $('#location-kind');
            kind.textContent = info.kind;
            const tag = document.createElement('span');
            tag.className = 'new-tag';
            tag.textContent = '新发现';
            $('#location-code').append(tag);
            plate.dataset.new = String(isNew);
            plate.dataset.unmapped = String(info.unmapped);
            plate.dataset.corridor = String(!location);
            if (info.colour) plate.style.setProperty('--kind-colour', info.colour);
            else plate.style.removeProperty('--kind-colour');
        },
        setDiscovered: (ids: readonly string[], total: number) => {
            discoveredIds = ids;
            map.setDiscovered(ids);
            renderProgress(total);
        },
        discovered: (location: CampusRoom, count: number, total: number) =>
            showToast(`发现新地点：${location.name}（${location.id}），已发现 ${count} / ${total}`, 'discovery'),
        notify: (message: string) => showToast(message),
        toggleMap: () => {
            if (root.dataset.screen !== 'play') return;
            root.dataset.map = root.dataset.map === 'open' ? 'closed' : 'open';
        },
        drawMaps: (x: number, z: number, forwardX: number, forwardZ: number) =>
            map.draw(x, z, forwardX, forwardZ, root.dataset.map === 'open'),
        /** Nickname typed on the title screen (remembered in this browser only). */
        nickname: () => {
            const value = $<HTMLInputElement>('#nickname').value.trim();
            try {
                window.localStorage.setItem(NICKNAME_KEY, value);
            } catch {
                /* storage unavailable */
            }
            return value;
        },
        nameTagLayer: () => $('#name-tags'),
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
            if (root.dataset.screen === 'play') showToast('游戏有新版本：按 Esc 后刷新即可更新', 'discovery', 8000);
        },
        /** Shows or hides the escape offer when the player seems stuck. */
        stuck: (show: boolean, onEscape?: () => void) => {
            const button = $<HTMLButtonElement>('#unstuck');
            if (onEscape) button.onclick = onEscape;
            button.hidden = !show;
        },
        net: (state: 'offline' | 'connecting' | 'online' | 'rejected', players: number) => {
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
            rows: { name: string; score: number; hp: number; alive: boolean; colour: number; me: boolean }[]
        ) => {
            const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
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
                    // The leader (first place with points) carries the 淘汰王 title.
                    if (sorted[0] === row && row.score > 0) {
                        item.dataset.leader = 'true';
                        const title = document.createElement('b');
                        title.className = 'title';
                        title.textContent = '淘汰王';
                        name.append(title);
                    }
                    name.append(row.name);
                    const score = document.createElement('b');
                    score.textContent = String(row.score);
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
        hitMarker: (kind: 'hit' | 'kill') => {
            const marker = $('#hitmarker');
            marker.dataset.kind = kind;
            marker.classList.remove('show');
            void marker.offsetWidth;
            marker.classList.add('show');
        },
        /** Red flash, plus an arc around the crosshair pointing toward the thrower (degrees, 0 = ahead, clockwise). */
        damage: (fromAngle: number | null = null) => {
            const damage = $('#damage');
            damage.classList.remove('show');
            void damage.offsetWidth;
            damage.classList.add('show');
            if (fromAngle === null) return;
            const arc = $('#damage-dir');
            arc.style.setProperty('--angle', `${fromAngle}deg`);
            arc.classList.remove('show');
            void arc.offsetWidth;
            arc.classList.add('show');
        },
        /** Elimination broadcast across the upper centre of the screen. */
        broadcast: (killer: string, victim: string, tone: 'neutral' | 'mine' | 'me', streak = 1) => {
            const banner = $('#broadcast');
            banner.dataset.tone = tone;
            const a = document.createElement('b');
            a.textContent = killer;
            const b = document.createElement('b');
            b.textContent = victim;
            banner.replaceChildren(a, document.createTextNode(' 淘汰了 '), b);
            if (streak > 1) {
                const tag = document.createElement('span');
                tag.className = 'streak';
                tag.textContent = streak >= 3 ? `${streak} 连淘汰！` : '双杀';
                banner.append(tag);
            }
            banner.hidden = false;
            banner.classList.remove('show');
            void banner.offsetWidth;
            banner.classList.add('show');
            window.clearTimeout(broadcastTimer);
            broadcastTimer = window.setTimeout(() => (banner.hidden = true), 2600);
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
