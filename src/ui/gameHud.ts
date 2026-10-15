import './gameHud.css';

type GameActions = { enter: () => void; recover: () => void };

export const createGameHud = () => {
    document.body.insertAdjacentHTML(
        'beforeend',
        '<main id="game-menu" data-mode="loading"><section class="card"><p class="eyebrow">MOONSHOT ACADEMY · FF-01</p><h1>Moonshot Open World</h1><p id="load-status">正在初始化校园…</p><progress id="load-progress" max="1" value="0"></progress><div class="menu-actions"><button id="enter-campus" disabled>Enter Campus</button><button id="recover-player" hidden>Recover to Safe Spawn</button></div><p id="load-error" role="alert"></p><p class="controls">WASD 移动 · Shift 冲刺 · Space 跳跃 · 鼠标环视 · Esc 暂停 · R 恢复</p></section></main><aside id="game-hud" aria-live="polite"><span class="crosshair" aria-hidden="true"></span><span id="current-location">FF-01 · 位置识别中</span><span class="pause-hint">Esc 暂停</span></aside><p id="game-toast" role="status" hidden></p>'
    );
    const menu = document.querySelector<HTMLElement>('#game-menu')!;
    const status = document.querySelector<HTMLElement>('#load-status')!;
    const progress = document.querySelector<HTMLProgressElement>('#load-progress')!;
    const enter = document.querySelector<HTMLButtonElement>('#enter-campus')!;
    const recover = document.querySelector<HTMLButtonElement>('#recover-player')!;
    const error = document.querySelector<HTMLElement>('#load-error')!;
    const hud = document.querySelector<HTMLElement>('#game-hud')!;

    return {
        setStatus: (value: string) => (status.textContent = value),
        setProgress: (value: number) => (progress.value = value),
        ready: ({ enter: onEnter, recover: onRecover }: GameActions) => {
            status.textContent = '校园与碰撞已准备';
            progress.value = 1;
            enter.disabled = false;
            enter.addEventListener('click', onEnter);
            recover.addEventListener('click', onRecover);
            menu.dataset.mode = 'ready';
        },
        playing: () => {
            menu.dataset.mode = 'playing';
            hud.dataset.active = 'true';
        },
        paused: () => {
            menu.dataset.mode = 'paused';
            enter.textContent = 'Resume';
            enter.disabled = false;
            recover.hidden = false;
            hud.dataset.active = 'false';
        },
        showError: (message: string) => {
            error.textContent = `${message}。请确认受控本地资产存在后重新加载。`;
            enter.disabled = true;
            menu.dataset.mode = 'error';
        },
        notify: (message: string, durationMs = 3500) => {
            const toast = document.querySelector<HTMLElement>('#game-toast')!;
            toast.textContent = message;
            toast.hidden = false;
            window.clearTimeout(Number(toast.dataset.timer));
            toast.dataset.timer = String(window.setTimeout(() => (toast.hidden = true), durationMs));
        },
        setLocation: (value: string) => {
            document.querySelector<HTMLElement>('#current-location')!.textContent = value;
        }
    };
};
