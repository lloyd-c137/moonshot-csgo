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
    <div class="title-column">
      <div class="plate">
        <span class="stripe" aria-hidden="true"></span>
        <div class="plate-body">
          <span class="plate-code">FF-01</span>
          <h1 id="title-heading">Moonshot Open World</h1>
          <p>自由走遍校园一层，找到每一个房间。</p>
        </div>
      </div>
      <ol class="stages" aria-label="加载进度"></ol>
      <div class="title-actions">
        <button class="primary" id="enter-button" type="button" disabled>正在加载</button>
        <p class="load-error" id="load-error" role="alert" hidden></p>
        <button class="secondary" id="reload-button" type="button" hidden>重新加载</button>
      </div>
      <dl class="controls">
        <div><dt><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span></dt><dd>移动</dd></div>
        <div><dt><span class="kbd">Shift</span></dt><dd>冲刺</dd></div>
        <div><dt><span class="kbd">空格</span></dt><dd>跳跃</dd></div>
        <div><dt><span class="kbd">M</span></dt><dd>全屏地图</dd></div>
        <div><dt><span class="kbd">Esc</span></dt><dd>暂停与设置</dd></div>
        <div><dt><span class="kbd">R</span></dt><dd>回到东入口</dd></div>
      </dl>
      <p class="fine-print">场景由 FF-01 平面图推导，墙高、门、家具与灯光为游戏补充，并非实地测量。</p>
    </div>
  </section>

  <section class="screen screen-hud" aria-label="游戏界面">
    <div class="location" id="location" aria-live="polite">
      <span class="stripe" aria-hidden="true"></span>
      <div class="location-body">
        <span class="location-code" id="location-code">—</span>
        <span class="location-name" id="location-name">正在定位</span>
        <span class="location-kind" id="location-kind"></span>
      </div>
    </div>
    <span class="crosshair" aria-hidden="true"></span>
    <div class="map-dock">
      <canvas id="minimap" width="150" height="150" aria-label="小地图，北方朝上"></canvas>
      <span class="tally" id="tally"></span>
    </div>
    <div class="hints" aria-hidden="true">
      <span><span class="kbd">M</span>地图</span>
      <span><span class="kbd">Esc</span>暂停</span>
    </div>
    <p class="toast" id="toast" role="status" hidden></p>
    <div class="full-map" aria-label="全屏地图">
      <div><canvas id="full-map"></canvas><p>按 M 关闭地图。斜线覆盖的房间还没去过。</p></div>
    </div>
  </section>

  <section class="screen screen-pause" aria-labelledby="pause-heading">
    <div class="pause-column">
      <h2 id="pause-heading">已暂停</h2>
      <div class="pause-actions">
        <button class="primary" id="resume-button" type="button">继续探索</button>
        <button class="secondary" id="recover-button" type="button">回到东入口</button>
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

export const createUi = (locations: CampusRoom[]) => {
    document.body.insertAdjacentHTML('beforeend', MARKUP);
    const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
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
        },
        ready: (actions: Actions, settings: Settings) => {
            for (const item of stagesList.querySelectorAll<HTMLElement>('li')) item.dataset.state = 'done';
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
            map.draw(x, z, forwardX, forwardZ, root.dataset.map === 'open')
    };
};

export type Ui = ReturnType<typeof createUi>;
