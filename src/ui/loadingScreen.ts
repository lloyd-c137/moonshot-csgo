import './loadingScreen.css';

export const createLoadingScreen = () => {
    document.body.insertAdjacentHTML(
        'beforeend',
        '<main id="game-ui" class="loading"><section class="card"><p class="eyebrow">MOONSHOT ACADEMY · FF-01</p><h1>Moonshot Open World</h1><p id="load-status">正在初始化校园…</p><progress id="load-progress" max="1" value="0"></progress><button id="enter-campus" disabled>Enter Campus</button><p id="load-error" role="alert"></p><p class="controls">WASD 移动 · Shift 冲刺 · Space 跳跃 · 鼠标环视 · Esc 暂停 · R 恢复</p></section></main>'
    );
    const status = document.querySelector<HTMLElement>('#load-status')!;
    const progress = document.querySelector<HTMLProgressElement>('#load-progress')!;
    const button = document.querySelector<HTMLButtonElement>('#enter-campus')!;
    const error = document.querySelector<HTMLElement>('#load-error')!;
    return {
        setStatus: (value: string) => (status.textContent = value),
        setProgress: (value: number) => (progress.value = value),
        ready: () => {
            status.textContent = '校园场景已加载';
            progress.value = 1;
            button.textContent = 'Gameplay in progress';
            button.disabled = true;
        },
        showError: (message: string) => {
            error.textContent = `${message}。请确认受控本地资产存在后重新加载。`;
            button.disabled = true;
        }
    };
};
