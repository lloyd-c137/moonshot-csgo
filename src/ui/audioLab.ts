// Development-only local audition panel. User video/derived clips stay outside public/ and Git.
import type { Sound } from '../gameplay/sound';

import './audioLab.css';

type Clip = { id: string; label: string; url: string; duration: number; mixed: boolean };
type Options = { sound: Sound; canvas: HTMLCanvasElement; range: () => void; position: () => [number, number, number] };

export const mountAudioLab = async ({ sound, canvas, range, position }: Options) => {
    const host = document.createElement('div');
    host.innerHTML = `
      <button class="audio-lab-toggle" type="button">音效配置 · P</button>
      <dialog class="audio-lab" aria-labelledby="audio-lab-title">
        <header><div><small>MOONSHOT · LOCAL AUDIO LAB</small><h2 id="audio-lab-title">拆分音效 · 游戏内对比</h2></div><button data-action="close" type="button">关闭</button></header>
        <p>每段视频音效都是独立选项。分别替换命中、击杀、爆头、碰撞声；选“原有音效”即可对比。按 P 暂停并切换，完成后继续游戏。</p>
        <p class="audio-lab-status" role="status">正在读取本地拆分片段…</p>
        <div class="audio-lab-rows"></div>
        <label class="audio-lab-loop"><input data-loop type="checkbox">循环当前试听</label>
        <footer><button data-action="stop" type="button">停止试听</button><button data-action="reset" type="button">全部恢复原声</button><button data-action="range" type="button">去试音靶场并进入游戏</button><button data-action="resume" type="button">继续游戏</button></footer>
        <p class="audio-lab-note">固定人偶：身体两次命中淘汰，爆头一次淘汰，死亡后 2.5 秒在原位置复活，不记录战绩。向附近墙面投掷测试碰撞。原视频有混合声音；可调起止点。本地素材未上传。</p>
      </dialog>
      <div class="audio-lab-dummy" aria-label="测试人偶状态"><strong>固定测试人偶</strong><span data-dummy-state>生命 2/2 · 死亡后原地复活</span></div>`;
    document.body.append(host);
    const dialog = host.querySelector('dialog')!;
    const status = host.querySelector<HTMLElement>('[role="status"]')!;
    const rows = host.querySelector('.audio-lab-rows')!;
    const loop = host.querySelector<HTMLInputElement>('[data-loop]')!;
    let timer = 0;
    const stop = () => {
        window.clearTimeout(timer);
        sound.stopTestClips();
    };
    const toggle = () => {
        if (dialog.open) return dialog.close();
        if (document.pointerLockElement) document.exitPointerLock();
        dialog.showModal();
    };
    host.querySelector('.audio-lab-toggle')!.addEventListener('click', toggle);
    window.addEventListener(
        'keydown',
        (event) => {
            if (!['KeyP', 'F8'].includes(event.code) || event.repeat) return;
            const element = event.target as HTMLElement | null;
            if (event.code === 'KeyP' && (element?.isContentEditable || element?.closest('input, textarea, select')))
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            toggle();
        },
        true
    );
    dialog.addEventListener('close', stop);
    const resume = () => {
        const screen = document.querySelector<HTMLElement>('#app-ui')?.dataset.screen;
        if (!['ready', 'play', 'paused'].includes(screen ?? '')) {
            status.textContent = '校园仍在加载，请稍候。';
            return;
        }
        dialog.close();
        void canvas.requestPointerLock().catch(() => {
            status.textContent = '请点击游戏的进入 / 继续按钮。';
        });
    };
    host.querySelector('[data-action="close"]')!.addEventListener('click', () => dialog.close());
    host.querySelector('[data-action="stop"]')!.addEventListener('click', stop);
    host.querySelector('[data-action="resume"]')!.addEventListener('click', resume);
    host.querySelector('[data-action="range"]')!.addEventListener('click', () => {
        range();
        resume();
    });

    const manifestUrl = new URL('/.audio-lab-local/manifest.json', window.location.origin);
    try {
        const response = await fetch(manifestUrl);
        if (!response.ok) throw new Error(`素材清单加载失败：${response.status}`);
        const data = (await response.json()) as { clips?: unknown };
        if (!Array.isArray(data.clips) || !data.clips.length || data.clips.length > 256)
            throw new Error('素材清单格式无效');
        const ids = new Set<string>();
        const clips = data.clips.map((raw: unknown): Clip => {
            if (!raw || typeof raw !== 'object') throw new Error('片段格式无效');
            const clip = raw as Clip;
            if (
                typeof clip.id !== 'string' ||
                ids.has(clip.id) ||
                typeof clip.label !== 'string' ||
                clip.label.length > 160 ||
                !/^clips\/[a-zA-Z0-9_-]+\.wav$/.test(clip.url) ||
                !Number.isFinite(clip.duration) ||
                clip.duration <= 0 ||
                clip.duration > 30
            )
                throw new Error('片段路径、ID 或时长无效');
            ids.add(clip.id);
            return clip;
        });
        const resets: (() => void)[] = [];
        for (const [cue, label] of [
            ['hit', '身体命中'],
            ['kill', '击杀确认'],
            ['head', '爆头确认'],
            ['bounce', '飞盘碰撞']
        ] as const) {
            const row = document.createElement('section');
            row.dataset.cue = cue;
            row.innerHTML = `<h3>${label}</h3><label>选择片段<select aria-label="${label}片段"><option value="original">原有音效</option></select></label>
              <div class="audio-lab-trim"><label>起点（秒）<input data-start type="number" min="0" step="0.01" value="0"></label><label>终点（秒）<input data-end type="number" min="0" step="0.01" value="1"></label></div>
              <label class="audio-lab-volume">候选音量<input data-gain type="range" min="0" max="1" step="0.01" value="0.35"><output>35%</output></label><button data-preview type="button">试听${label}</button>`;
            const select = row.querySelector('select')!;
            for (const clip of clips) select.add(new Option(`${clip.label} · ${clip.duration.toFixed(2)}s`, clip.id));
            const start = row.querySelector<HTMLInputElement>('[data-start]')!;
            const end = row.querySelector<HTMLInputElement>('[data-end]')!;
            const gain = row.querySelector<HTMLInputElement>('[data-gain]')!;
            const output = row.querySelector('output')!;
            let generation = 0;
            const apply = async () => {
                const current = ++generation;
                const clip = clips.find((entry) => entry.id === select.value);
                output.textContent = `${Math.round(Number(gain.value) * 100)}%`;
                try {
                    await sound.setTestClip(
                        cue,
                        clip ? new URL(clip.url, manifestUrl).href : null,
                        Number(gain.value),
                        Number(start.value),
                        Number(end.value)
                    );
                    if (generation !== current) return false;
                    status.textContent = clip
                        ? `${label}：${clip.label}，已应用${clip.mixed ? '（连续混合片段，可调起止点）' : ''}`
                        : `${label}：原有音效`;
                    return true;
                } catch (error) {
                    if (generation === current) status.textContent = (error as Error).message;
                    return false;
                }
            };
            select.addEventListener('change', () => {
                stop();
                const clip = clips.find((entry) => entry.id === select.value);
                start.value = '0';
                end.value = String(clip?.duration ?? 1);
                start.disabled = end.disabled = gain.disabled = !clip;
                void apply();
            });
            for (const input of [start, end, gain])
                input.addEventListener('input', () => {
                    void apply();
                });
            const preview = async () => {
                stop();
                if (!(await apply())) return;
                if (cue === 'bounce') sound.bounce(position(), 10);
                else sound.hitConfirm(cue === 'head' || cue === 'kill', cue === 'head');
                if (loop.checked && dialog.open)
                    timer = window.setTimeout(
                        () => {
                            void preview();
                        },
                        Math.max(500, (Number(end.value) - Number(start.value)) * 1000 + 250)
                    );
            };
            row.querySelector('[data-preview]')!.addEventListener('click', () => {
                void preview();
            });
            resets.push(() => {
                select.value = 'original';
                start.disabled = end.disabled = gain.disabled = true;
                void apply();
            });
            start.disabled = end.disabled = gain.disabled = true;
            rows.append(row);
        }
        host.querySelector('[data-action="reset"]')!.addEventListener('click', () => {
            stop();
            resets.forEach((reset) => reset());
        });
        status.textContent = `已载入 ${clips.length} 个独立片段。人偶在出生点正前方；P 随时切换音效。`;
    } catch (error) {
        status.textContent = `${(error as Error).message}。请在本机提供 .audio-lab-local/manifest.json 和 clips/。`;
    }
    const dummyState = host.querySelector<HTMLElement>('[data-dummy-state]')!;
    const dummyHud = host.querySelector<HTMLElement>('.audio-lab-dummy')!;
    return {
        hit(head: boolean, eliminated: boolean) {
            status.textContent = `实际投掷已触发${head ? '爆头' : eliminated ? '击杀' : '身体命中'}音效；按 P 切换后可继续对比。`;
        },
        dummy(hp: number, respawnSeconds: number) {
            const text =
                hp > 0 ? `生命 ${hp}/2 · 死亡后原地复活` : `已淘汰 · ${respawnSeconds.toFixed(1)} 秒后原地复活`;
            if (dummyState.textContent !== text) dummyState.textContent = text;
            if (dummyHud.dataset.hp !== String(hp)) dummyHud.dataset.hp = String(hp);
        }
    };
};

export type AudioLabUi = Awaited<ReturnType<typeof mountAudioLab>>;
