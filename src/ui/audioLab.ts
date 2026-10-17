// Development-only local audition panel. User video/derived clips stay outside public/ and Git.
import type { Sound, TestSoundCue } from '../gameplay/sound';

import './audioLab.css';

type Clip = { id: string; label: string; url: string; duration: number; mixed: boolean; cues?: TestSoundCue[] };
type Options = {
    sound: Sound;
    canvas: HTMLCanvasElement;
    range: () => void;
    position: () => [number, number, number];
    setGolden: (value: boolean) => void;
    setDummyScale: (scale: number) => void;
    setCameraKick: (scale: number | null) => void;
    setEffectIntensity: (intensity: number | null) => void;
    getCameraKick: () => number;
    getEffectIntensity: () => number;
    simulateDummyHit: (scenario: 'body' | 'head' | 'elimination' | 'golden') => void;
};

export const mountAudioLab = async ({
    sound,
    canvas,
    range,
    position,
    setGolden,
    setDummyScale,
    setCameraKick,
    setEffectIntensity,
    getCameraKick,
    getEffectIntensity,
    simulateDummyHit
}: Options) => {
    const host = document.createElement('div');
    host.innerHTML = `
      <button class="audio-lab-toggle" type="button">音效配置 · P</button>
      <dialog class="audio-lab" aria-labelledby="audio-lab-title">
        <header><div><small>MOONSHOT · LOCAL AUDIO LAB</small><h2 id="audio-lab-title">拆分音效 · 游戏内对比</h2></div><button data-action="close" type="button">关闭</button></header>
        <p>金飞盘击杀候选来自第一段视频的片段 06；破空候选来自新视频，作用于普通与狙击投掷释放声。选“原有音效”使用生产默认配置。按 P 暂停并切换。</p>
        <label class="audio-lab-scale">测试人偶高度 <output data-dummy-height>2.10 m</output><input data-dummy-scale type="range" min="0.60" max="2.10" step="0.05" value="2.10"><small>仅调整本地测试人偶；拖动比较不同高度，其他角色与碰撞判定不变。</small></label>
        <div class="audio-lab-tuning" aria-label="战斗反馈参数">
          <label>相机冲击强度 <output data-camera-kick-value></output><input data-camera-kick type="range" min="0" max="1.5" step="0.05"></label>
          <label>命中粒子强度 <output data-effect-intensity-value></output><input data-effect-intensity type="range" min="0" max="1.5" step="0.05"></label>
          <small>仅本地开发面板生效；关闭面板后恢复游戏设置。调整相机冲击和命中粒子密度后，用人偶场景进行比较。</small>
        </div>
        <div class="audio-lab-scenarios" aria-label="战斗反馈场景"><strong>战斗反馈快速对比</strong><button data-scenario="body" type="button">身体命中</button><button data-scenario="head" type="button">爆头</button><button data-scenario="elimination" type="button">普通淘汰</button><button data-scenario="golden" type="button">金盘淘汰</button><small>直接驱动固定人偶的本地命中、动作、特效和音效流程，不影响战绩；人偶死亡后原地复活。</small></div>
        <p class="audio-lab-status" role="status">正在读取本地拆分片段…</p>
        <div class="audio-lab-rows"></div>
        <label class="audio-lab-loop"><input data-loop type="checkbox">循环当前试听</label>
        <label class="audio-lab-loop"><input data-golden type="checkbox">金飞盘试音：人偶淘汰时使用“金飞盘击杀”候选</label>
        <footer><button data-action="stop" type="button">停止试听</button><button data-action="reset" type="button">全部恢复原声</button><button data-action="range" type="button">去试音靶场并进入游戏</button><button data-action="resume" type="button">继续游戏</button></footer>
        <p class="audio-lab-note">固定人偶：身体两次命中淘汰，爆头一次淘汰；从背后靠近后按 V 或点处决按钮，双方播放处决动作，完成后 2.5 秒原地复活，不记录战绩。新候选保留视频中的背景混音，未做声源分离，可调起止点；仅供本地评估。生产默认的 10／12／16 不受候选库精简影响。</p>
      </dialog>
      <div class="audio-lab-dummy" aria-label="测试人偶状态"><strong>固定测试人偶</strong><span data-dummy-state>生命 2/2 · 死亡后原地复活</span></div>`;
    document.body.append(host);
    const dialog = host.querySelector('dialog')!;
    const status = host.querySelector<HTMLElement>('[role="status"]')!;
    const rows = host.querySelector('.audio-lab-rows')!;
    const loop = host.querySelector<HTMLInputElement>('[data-loop]')!;
    const dummyScale = host.querySelector<HTMLInputElement>('[data-dummy-scale]')!;
    const dummyHeight = host.querySelector<HTMLOutputElement>('[data-dummy-height]')!;
    const cameraKickRange = host.querySelector<HTMLInputElement>('[data-camera-kick]')!;
    const cameraKickValue = host.querySelector<HTMLOutputElement>('[data-camera-kick-value]')!;
    const effectIntensityRange = host.querySelector<HTMLInputElement>('[data-effect-intensity]')!;
    const effectIntensityValue = host.querySelector<HTMLOutputElement>('[data-effect-intensity-value]')!;
    cameraKickRange.value = String(getCameraKick());
    cameraKickValue.value = `${Number(cameraKickRange.value).toFixed(2)}×`;
    effectIntensityRange.value = String(getEffectIntensity());
    effectIntensityValue.value = `${Math.round(Number(effectIntensityRange.value) * 100)}%`;
    cameraKickRange.addEventListener('input', () => {
        const value = Number(cameraKickRange.value);
        cameraKickValue.value = `${value.toFixed(2)}×`;
        setCameraKick(value);
    });
    effectIntensityRange.addEventListener('input', () => {
        const value = Number(effectIntensityRange.value);
        effectIntensityValue.value = `${Math.round(value * 100)}%`;
        setEffectIntensity(value);
    });
    dummyScale.addEventListener('input', () => {
        const height = Number(dummyScale.value);
        dummyHeight.value = `${height.toFixed(2)} m`;
        setDummyScale(height / 1.829);
    });
    host.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
        button.addEventListener('click', () =>
            simulateDummyHit(button.dataset.scenario as 'body' | 'head' | 'elimination' | 'golden')
        );
    });
    host.querySelector<HTMLInputElement>('[data-golden]')!.addEventListener('change', (event) => {
        setGolden((event.target as HTMLInputElement).checked);
    });
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
    dialog.addEventListener('close', () => {
        stop();
        setCameraKick(null);
        setEffectIntensity(null);
    });
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
                clip.duration > 30 ||
                (clip.cues !== undefined &&
                    (!Array.isArray(clip.cues) ||
                        !clip.cues.length ||
                        clip.cues.some((cue) => !['hit', 'head', 'kill', 'bounce', 'goldKill', 'throw'].includes(cue))))
            )
                throw new Error('片段路径、ID 或时长无效');
            ids.add(clip.id);
            return clip;
        });
        const resets: (() => void)[] = [];
        for (const [cue, label] of [
            ['goldKill', '金飞盘击杀'],
            ['throw', '飞盘破空'],
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
            for (const clip of clips.filter((entry) => !entry.cues || entry.cues.includes(cue)))
                select.add(new Option(`${clip.label} · ${clip.duration.toFixed(2)}s`, clip.id));
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
                if (cue === 'goldKill') {
                    host.querySelector<HTMLInputElement>('[data-golden]')!.checked = !!clip;
                    setGolden(!!clip);
                }
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
                else if (cue === 'throw') sound.throw();
                else if (cue === 'goldKill') sound.snipeConfirm(false, true);
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
            host.querySelector<HTMLInputElement>('[data-golden]')!.checked = false;
            setGolden(false);
        });
        status.textContent = `已载入 ${clips.length} 个选项，按用途分栏；片段 06 完整版仅供对照。人偶在出生点正前方；P 随时切换。`;
    } catch (error) {
        status.textContent = `${(error as Error).message}。请在本机提供 .audio-lab-local/manifest.json 和 clips/。`;
    }
    const dummyState = host.querySelector<HTMLElement>('[data-dummy-state]')!;
    const dummyHud = host.querySelector<HTMLElement>('.audio-lab-dummy')!;
    return {
        hit(head: boolean, eliminated: boolean, golden = false) {
            status.textContent = `实际投掷已触发${golden && eliminated ? '金飞盘击杀' : head ? '爆头' : eliminated ? '击杀' : '身体命中'}音效；按 P 切换后可继续对比。`;
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
