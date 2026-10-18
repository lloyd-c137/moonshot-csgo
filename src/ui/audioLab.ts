// Development-only local audition panel. User video/derived clips stay outside public/ and Git.
import type { MomentCutscene } from '../gameplay/cutscenes/cutscenes';
import type { Sound, TestSoundCue } from '../gameplay/sound';
import { MAX_HP } from '../net/protocol';

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
    setTrailDensity: (density: number | null) => void;
    setTrailLength: (seconds: number | null) => void;
    setHudDuration: (scale: number) => void;
    setSimulatedRtt: (milliseconds: number) => void;
    getCameraKick: () => number;
    getEffectIntensity: () => number;
    getTrailDensity: () => number;
    getTrailLength: () => number;
    getHudDuration: () => number;
    getSimulatedRtt: () => number;
    simulateDummyHit: (scenario: 'body' | 'head' | 'elimination' | 'golden' | 'execution') => void;
    simulateBlackout: () => Promise<'server' | 'local'>;
    simulateFinalMinute: () => Promise<'server' | 'local'>;
    /** The final entrance ceremony: on the server clock when connected, otherwise played locally with stand-ins. */
    simulateCeremony: () => Promise<'server' | 'local'>;
    simulateBreaker: () => void;
    simulateMomentCutscene: (kind: MomentCutscene['kind']) => void;
    resetTestMechanics: () => void;
    simulateRoundResult: (outcome: 'golden-disc' | 'last-survivor' | 'draw', mine: boolean) => void;
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
    setTrailDensity,
    setTrailLength,
    setHudDuration,
    setSimulatedRtt,
    getCameraKick,
    getEffectIntensity,
    getTrailDensity,
    getTrailLength,
    getHudDuration,
    getSimulatedRtt,
    simulateDummyHit,
    simulateBlackout,
    simulateFinalMinute,
    simulateCeremony,
    simulateBreaker,
    simulateMomentCutscene,
    resetTestMechanics,
    simulateRoundResult
}: Options) => {
    const host = document.createElement('div');
    host.innerHTML = `
      <button class="audio-lab-toggle" type="button">音效配置 · P</button>
      <dialog class="audio-lab" aria-labelledby="audio-lab-title">
        <header><div><small>MOONSHOT · LOCAL AUDIO LAB</small><h2 id="audio-lab-title">拆分音效 · 游戏内对比</h2></div><button data-action="close" type="button">关闭</button></header>
        <p>金飞盘击杀候选来自第一段视频的片段 06；破空候选来自新视频，作用于普通与狙击投掷释放声。选“原有音效”使用生产默认配置。按 P 暂停并切换。</p>
        <label class="audio-lab-scale">测试人偶高度 <output data-dummy-height>2.10 m</output><input data-dummy-scale type="range" min="0.60" max="2.10" step="0.05" value="2.10"><small>仅调整本地测试人偶；拖动比较不同高度，其他角色与碰撞判定不变。</small></label>
        <div class="audio-lab-tuning" aria-label="战斗反馈参数">
          <label>相机冲击强度 <output data-camera-kick-value></output><input data-camera-kick type="range" min="0" max="1.5" step="0.01"></label>
          <label>命中粒子强度 <output data-effect-intensity-value></output><input data-effect-intensity type="range" min="0" max="1.5" step="0.05"></label>
          <label>飞盘轨迹密度 <output data-trail-density-value></output><input data-trail-density type="range" min="0" max="1.5" step="0.05"></label>
          <label>飞盘轨迹长度 <output data-trail-length-value></output><input data-trail-length type="range" min="0.08" max="0.8" step="0.04"></label>
          <label>战斗 HUD 时长 <output data-hud-duration-value></output><input data-hud-duration type="range" min="0.5" max="1.75" step="0.05"><small>统一缩放命中标记、提示、淘汰横幅和金盘横幅的显示时长。</small></label>
          <label>模拟网络 RTT <output data-rtt-value></output><input data-rtt type="range" min="0" max="400" step="20"><small>收发各延迟一半；0 / 80 / 200 / 400 ms。只影响当前开发测试会话。</small></label>
          <small>仅本地开发会话生效，不保存到账号或设置。可关闭面板进入场景比较，再回来微调。</small>
        </div>
        <div class="audio-lab-scenarios" aria-label="战斗反馈场景"><strong>战斗反馈快速对比</strong><button data-scenario="body" type="button">身体命中</button><button data-scenario="head" type="button">爆头</button><button data-scenario="elimination" type="button">普通淘汰</button><button data-scenario="golden" type="button">金盘淘汰</button><button data-action="execution-demo" type="button">处决人偶测试</button><small>命中预设直接驱动固定人偶反馈；处决按钮会进入背后站位，再按 V 播放实际双角色动作。人偶死亡后原地复活。</small></div>
        <div class="audio-lab-scenarios" aria-label="回合机制快速触发"><strong>机制快速测试</strong><button data-phase="breaker" type="button">直接拉闸</button><button data-phase="blackout" type="button">终局夜晚</button><button data-phase="final" type="button">最终球场对决</button><button data-phase="ceremony" type="button">Final 入场仪式</button><button data-phase="gold-first" type="button">金盘首次争夺</button><button data-phase="last-two" type="button">最后两人对决</button><button data-phase="reset" type="button">恢复测试状态</button><button data-result="golden-disc" data-mine="true" type="button">金盘胜利</button><button data-result="last-survivor" data-mine="false" type="button">失败展示</button><button data-result="draw" data-mine="false" type="button">平局展示</button><small>本地测试可以直接查看拉闸、终局夜晚、金盘争夺、最后两人对决与最终球场传送，不需跑图或等待倒计时；本机演示不改战绩、不影响其他玩家。连上开发测试服时，夜晚/最终对决优先使用服务器时钟。</small></div>
        <p class="audio-lab-status" role="status">正在读取本地拆分片段…</p>
        <div class="audio-lab-rows"></div>
        <label class="audio-lab-loop"><input data-loop type="checkbox">循环当前试听</label>
        <label class="audio-lab-loop"><input data-golden type="checkbox">金飞盘试音：人偶淘汰时使用“金飞盘击杀”候选</label>
        <footer><button data-action="stop" type="button">停止试听</button><button data-action="reset" type="button">全部恢复原声</button><button data-action="reset-tuning" type="button">恢复调节默认</button><button data-action="range" type="button">去试音靶场并进入游戏</button><button data-action="resume" type="button">继续游戏</button></footer>
        <p class="audio-lab-note">固定人偶：身体两次命中淘汰，爆头一次淘汰；从背后靠近后按 V 或点处决按钮，双方播放处决动作，完成后 2.5 秒原地复活，不记录战绩。新候选保留视频中的背景混音，未做声源分离，可调起止点；仅供本地评估。生产默认的 10／12／16 不受候选库精简影响。</p>
      </dialog>
      <div class="audio-lab-dummy" aria-label="测试人偶状态"><strong>固定测试人偶</strong><span data-dummy-state>生命 ${MAX_HP}/${MAX_HP} · 死亡后原地复活</span></div>`;
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
    const trailDensityRange = host.querySelector<HTMLInputElement>('[data-trail-density]')!;
    const trailDensityValue = host.querySelector<HTMLOutputElement>('[data-trail-density-value]')!;
    const trailLengthRange = host.querySelector<HTMLInputElement>('[data-trail-length]')!;
    const trailLengthValue = host.querySelector<HTMLOutputElement>('[data-trail-length-value]')!;
    const hudDurationRange = host.querySelector<HTMLInputElement>('[data-hud-duration]')!;
    const hudDurationValue = host.querySelector<HTMLOutputElement>('[data-hud-duration-value]')!;
    const rttRange = host.querySelector<HTMLInputElement>('[data-rtt]')!;
    const rttValue = host.querySelector<HTMLOutputElement>('[data-rtt-value]')!;
    cameraKickRange.value = String(getCameraKick());
    cameraKickValue.value = `${Number(cameraKickRange.value).toFixed(2)}×`;
    effectIntensityRange.value = String(getEffectIntensity());
    effectIntensityValue.value = `${Math.round(Number(effectIntensityRange.value) * 100)}%`;
    trailDensityRange.value = String(getTrailDensity());
    trailDensityValue.value = `${Math.round(Number(trailDensityRange.value) * 100)}%`;
    trailLengthRange.value = String(getTrailLength());
    trailLengthValue.value = `${Math.round(Number(trailLengthRange.value) * 1000)} ms`;
    hudDurationRange.value = String(getHudDuration());
    hudDurationValue.value = `${Number(hudDurationRange.value).toFixed(2)}×`;
    rttRange.value = String(getSimulatedRtt());
    rttValue.value = `${rttRange.value} ms`;
    const originalTuning = {
        cameraKick: Number(cameraKickRange.value),
        effectIntensity: Number(effectIntensityRange.value),
        trailDensity: Number(trailDensityRange.value),
        trailLength: Number(trailLengthRange.value),
        hudDuration: Number(hudDurationRange.value),
        simulatedRtt: Number(rttRange.value)
    };
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
    trailDensityRange.addEventListener('input', () => {
        const value = Number(trailDensityRange.value);
        trailDensityValue.value = `${Math.round(value * 100)}%`;
        setTrailDensity(value);
    });
    trailLengthRange.addEventListener('input', () => {
        const value = Number(trailLengthRange.value);
        trailLengthValue.value = `${Math.round(value * 1000)} ms`;
        setTrailLength(value);
    });
    hudDurationRange.addEventListener('input', () => {
        const value = Number(hudDurationRange.value);
        hudDurationValue.value = `${value.toFixed(2)}×`;
        setHudDuration(value);
    });
    rttRange.addEventListener('input', () => {
        const value = Number(rttRange.value);
        rttValue.value = `${value} ms`;
        setSimulatedRtt(value);
    });
    dummyScale.addEventListener('input', () => {
        const height = Number(dummyScale.value);
        dummyHeight.value = `${height.toFixed(2)} m`;
        setDummyScale(height / 1.829);
    });
    host.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
        button.addEventListener('click', () => simulateDummyHit(button.dataset.scenario as 'body' | 'head' | 'elimination' | 'golden' | 'execution'));
    });
    host.querySelector<HTMLButtonElement>('[data-phase="blackout"]')!.addEventListener('click', async () => {
        const result = await simulateBlackout();
        status.textContent = result === 'server'
            ? '已同步触发终局夜晚；关闭面板观察照明、保安和最终规则。'
            : '已在本机触发终局夜晚；仅当前浏览器演示，不改变服务器回合。';
    });
    host.querySelector<HTMLButtonElement>('[data-phase="final"]')!.addEventListener('click', async () => {
        const result = await simulateFinalMinute();
        status.textContent = result === 'server'
            ? '已同步触发最终球场对决；关闭面板观察公告、遮罩、灯光与传送。'
            : '已在本机触发最终球场对决；仅当前浏览器演示，不改变服务器回合。';
    });
    host.querySelector<HTMLButtonElement>('[data-phase="ceremony"]')!.addEventListener('click', async () => {
        const result = await simulateCeremony();
        status.textContent = result === 'server'
            ? '已同步触发 Final 入场仪式；关闭面板观看入场、探照灯、封门与亮灯。'
            : '已在本机播放 Final 入场仪式（你和 4 名替身）；仅当前浏览器演示。';
    });
    host.querySelector<HTMLButtonElement>('[data-phase="breaker"]')!.addEventListener('click', () => {
        simulateBreaker();
        status.textContent = '已在本机直接拉闸；可观察灭灯、提示音、背景音乐和保安修闸路线。';
    });
    for (const kind of ['gold-first', 'last-two'] as const) {
        host.querySelector<HTMLButtonElement>(`[data-phase="${kind}"]`)!.addEventListener('click', () => {
            simulateMomentCutscene(kind);
            status.textContent = kind === 'gold-first' ? '已触发金飞盘首次争夺过场。' : '已触发最后两人对决过场。';
        });
    }
    host.querySelector<HTMLButtonElement>('[data-phase="reset"]')!.addEventListener('click', () => {
        resetTestMechanics();
        status.textContent = '测试机制已复位。';
    });
    host.querySelectorAll<HTMLButtonElement>('[data-result]').forEach((button) => {
        button.addEventListener('click', () => {
            const outcome = button.dataset.result as 'golden-disc' | 'last-survivor' | 'draw';
            simulateRoundResult(outcome, button.dataset.mine === 'true');
            status.textContent = `已播放${button.textContent}卡片与回合提示音；仅本地演示，不记录战绩。`;
        });
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
    dialog.addEventListener('close', stop);
    host.querySelector('[data-action="reset-tuning"]')!.addEventListener('click', () => {
        cameraKickRange.value = String(originalTuning.cameraKick);
        cameraKickRange.dispatchEvent(new Event('input', { bubbles: true }));
        effectIntensityRange.value = String(originalTuning.effectIntensity);
        effectIntensityRange.dispatchEvent(new Event('input', { bubbles: true }));
        trailDensityRange.value = String(originalTuning.trailDensity);
        trailDensityRange.dispatchEvent(new Event('input', { bubbles: true }));
        trailLengthRange.value = String(originalTuning.trailLength);
        trailLengthRange.dispatchEvent(new Event('input', { bubbles: true }));
        hudDurationRange.value = String(originalTuning.hudDuration);
        hudDurationRange.dispatchEvent(new Event('input', { bubbles: true }));
        rttRange.value = String(originalTuning.simulatedRtt);
        rttRange.dispatchEvent(new Event('input', { bubbles: true }));
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
    host.querySelector('[data-action="execution-demo"]')!.addEventListener('click', () => {
        range();
        status.textContent = '已进入人偶背后处决站位，按 V 或点击游戏内处决按钮开始双角色动作。';
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
                hp > 0
                    ? `生命 ${hp}/${MAX_HP} · 死亡后原地复活`
                    : `已淘汰 · ${respawnSeconds.toFixed(1)} 秒后原地复活`;
            if (dummyState.textContent !== text) dummyState.textContent = text;
            if (dummyHud.dataset.hp !== String(hp)) dummyHud.dataset.hp = String(hp);
        }
    };
};

export type AudioLabUi = Awaited<ReturnType<typeof mountAudioLab>>;
