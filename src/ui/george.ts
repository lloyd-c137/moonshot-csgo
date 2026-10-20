import type { GeorgeProgress, GeorgeReboot } from '../net/protocol';

type GeorgeCredential = { id: string; code: string; status: 'available' | 'used' | 'revoked' } | null;
type Actions = { login: (id: string, code: string) => void; start: (id: string) => void; disarm: (id: string) => void; cancelDisarm: (id: string) => void; focus: (active: boolean) => void };

let requestSequence = 0;
const requestId = () => `george-${Math.floor(performance.now())}-${++requestSequence}`;

export const createGeorgeView = (actions: Actions) => {
    const root = document.createElement('section');
    root.className = 'george-hud';
    root.innerHTML = `
        <div class="george-progress" aria-live="polite">
            <div class="george-progress-heading"><span>⌁</span><strong>GEORGE'S PASSWORD</strong><b>0/10</b></div>
            <div class="george-progress-track"><i></i></div>
            <small>ONE LIFE · CONSECUTIVE ELIMINATIONS</small>
            <button class="george-code-toggle" type="button" hidden>VIEW PASSWORD</button>
        </div>
        <div class="george-milestone" aria-live="assertive" hidden><b></b><span></span></div>
        <div class="george-alert" aria-live="assertive" hidden>GEORGE PROTOCOL · CREDENTIAL LEAK DETECTED</div>
        <div class="george-reboot" aria-live="assertive" hidden></div>
        <button class="george-disarm" type="button" hidden>HOLD E · ABORT SERVER REBOOT</button>
        <button class="george-terminal-prompt" type="button" hidden></button>
        <div class="george-console-backdrop" hidden>
            <section class="george-console" role="dialog" aria-modal="true" aria-labelledby="george-console-title">
                <button class="george-console-close" aria-label="Close" type="button">×</button>
                <small>M103 · MAKERSPACE</small><h2 id="george-console-title">GEORGE / SERVER CONSOLE</h2>
                <p>USER: GEORGE</p><p class="george-console-status">AUTHENTICATION REQUIRED</p>
                <label>ENTER PASSWORD<input class="george-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" /></label>
                <button class="george-login" type="button">AUTHENTICATE</button>
                <button class="george-restart" type="button" hidden>RESTART SERVER</button>
                <button class="george-confirm" type="button" hidden>CONFIRM REBOOT</button>
            </section>
        </div>
        <div class="george-blackout" hidden><strong>CONNECTION LOST</strong><span></span></div>`;
    document.body.append(root);
    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const countEl = $('.george-progress-heading b');
    const fill = $('.george-progress-track i');
    const codeToggle = $('.george-code-toggle');
    const milestone = $('.george-milestone');
    const alert = $('.george-alert');
    const rebootEl = $('.george-reboot');
    const prompt = $('.george-terminal-prompt') as HTMLButtonElement;
    const backdrop = $('.george-console-backdrop');
    const input = $('.george-code-input') as HTMLInputElement;
    const status = $('.george-console-status');
    const loginButton = $('.george-login') as HTMLButtonElement;
    const restartButton = $('.george-restart') as HTMLButtonElement;
    const confirmButton = $('.george-confirm') as HTMLButtonElement;
    const disarmButton = $('.george-disarm') as HTMLButtonElement;
    const blackout = $('.george-blackout');
    let progress: GeorgeProgress = { streak: 0, required: 10, unlocked: false, issuedThisRound: false, credentialAvailable: false };
    let credential: GeorgeCredential = null;
    let reboot: GeorgeReboot = { phase: 'idle' };
    let nearby = false;
    let authenticated = false;
    let revealed = false;
    let lastMilestone = 0;
    let hideMilestoneAt = 0;
    let lastSecond = -1;
    let disarmRequest: string | null = null;
    let lastDisarmHeartbeatAt = 0;
    let terminalOpen = false;
    let myId = '';

    const showMilestone = (title: string, detail: string, streak: number) => {
        if (streak <= lastMilestone) return;
        lastMilestone = streak;
        milestone.querySelector('b')!.textContent = title;
        milestone.querySelector('span')!.textContent = detail;
        milestone.hidden = false;
        hideMilestoneAt = performance.now() + 1500;
    };
    const renderProgress = (value: GeorgeProgress) => {
        const previous = progress.streak;
        progress = value;
        countEl.textContent = `${value.streak}/10`;
        fill.style.width = `${value.streak * 10}%`;
        codeToggle.hidden = !value.credentialAvailable || !credential;
        if (value.streak === 5 && previous < 5) showMilestone("GEORGE'S PASSWORD", 'HALFWAY TO ACCESS', 5);
        else if (value.streak === 8 && previous < 8) showMilestone('2 ELIMINATIONS REMAINING', 'KEEP THE STREAK ALIVE', 8);
        else if (value.streak === 9 && previous < 9) showMilestone('ONE MORE ELIMINATION', 'THE PASSWORD IS WITHIN REACH', 9);
        else if (value.streak === 10 && previous < 10) showMilestone('GEORGE’S PASSWORD ACQUIRED', 'OBJECTIVE: M103 MAKERSPACE', 10);
    };
    const renderReboot = (value: GeorgeReboot) => {
        reboot = value;
        lastSecond = -1;
        if (value.phase === 'pending') {
            rebootEl.hidden = false;
            rebootEl.innerHTML = `GEORGE PROTOCOL <b>SERVER REBOOT INITIATED</b><strong></strong><small>MAKERSPACE · ABORT THE REBOOT</small><div class="george-disarm-track"><i></i></div>`;
            disarmButton.hidden = !(nearby && value.initiatorId !== myId && (!value.disarmerId || value.disarmerId === myId));
            if (terminalOpen) closeConsole();
            backdrop.hidden = true;
        } else if (value.phase === 'resolved') {
            rebootEl.hidden = true;
            if (value.outcome === 'aborted') {
                alert.textContent = `SERVER REBOOT ABORTED${value.disarmedBy ? ` · ${value.disarmedBy}` : ''}`;
                alert.hidden = false;
                window.setTimeout(() => (alert.hidden = true), 3000);
            }
        } else if (value.phase === 'idle') rebootEl.hidden = true;
    };
    const closeConsole = () => {
        if (terminalOpen) actions.focus(false);
        backdrop.hidden = true;
        terminalOpen = false;
        authenticated = false;
        confirmButton.hidden = true;
        restartButton.hidden = true;
        loginButton.hidden = false;
        input.disabled = false;
    };
    const openTerminal = () => {
        if (!nearby || reboot.phase !== 'idle') return;
        backdrop.hidden = false;
        terminalOpen = true;
        actions.focus(true);
        authenticated = false;
        status.textContent = credential?.status === 'available' ? 'AUTHENTICATION REQUIRED' : 'GEORGE’S SERVER · ACCESS RESTRICTED';
        loginButton.hidden = !credential;
        input.value = '';
        input.focus();
    };
    prompt.addEventListener('click', openTerminal);
    $('.george-console-close').addEventListener('click', closeConsole);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeConsole(); });
    codeToggle.addEventListener('click', () => {
        revealed = !revealed;
        codeToggle.textContent = revealed ? `PASSWORD · ${credential?.code ?? '------'} · HIDE` : 'VIEW PASSWORD · P';
    });
    loginButton.addEventListener('click', () => {
        if (!/^\d{6}$/.test(input.value)) { status.textContent = 'ENTER THE SIX-DIGIT PASSWORD'; return; }
        actions.login(requestId(), input.value);
        status.textContent = 'AUTHENTICATING…';
    });
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); loginButton.click(); }
        if (event.key === 'Escape') { event.preventDefault(); closeConsole(); }
    });
    restartButton.addEventListener('click', () => {
        if (!authenticated) return;
        restartButton.hidden = true;
        confirmButton.hidden = false;
        status.textContent = 'CONFIRM REBOOT?';
    });
    confirmButton.addEventListener('click', () => {
        if (!authenticated) return;
        actions.start(requestId());
        confirmButton.disabled = true;
        status.textContent = 'REQUESTING REBOOT…';
    });
    const beginDisarm = () => {
        if (!nearby || reboot.phase !== 'pending' || reboot.initiatorId === myId || (reboot.disarmerId && reboot.disarmerId !== myId) || disarmRequest) return;
        disarmRequest = requestId();
        actions.disarm(disarmRequest);
        lastDisarmHeartbeatAt = performance.now();
        disarmButton.classList.add('is-holding');
    };
    const cancelDisarm = () => {
        if (!disarmRequest) return;
        actions.cancelDisarm(requestId());
        disarmRequest = null;
        lastDisarmHeartbeatAt = 0;
        disarmButton.classList.remove('is-holding');
    };
    disarmButton.addEventListener('pointerdown', (event) => { event.preventDefault(); beginDisarm(); });
    prompt.addEventListener('pointerdown', (event) => {
        if (reboot.phase !== 'pending') return;
        event.preventDefault();
        beginDisarm();
    });
    window.addEventListener('pointerup', cancelDisarm);
    disarmButton.addEventListener('pointerleave', cancelDisarm);
    disarmButton.addEventListener('contextmenu', (event) => event.preventDefault());
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement &&
        (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.repeat || event.isComposing) return;
        if (event.code === 'KeyP' && !isTyping(event.target) && credential?.status === 'available' && !terminalOpen) {
            revealed = !revealed;
            codeToggle.textContent = revealed ? `PASSWORD · ${credential.code} · HIDE` : 'VIEW PASSWORD · P';
        } else if (event.code === 'Enter' && terminalOpen && (input.disabled || !isTyping(event.target))) {
            event.preventDefault();
            if (!confirmButton.hidden) confirmButton.click();
            else if (!restartButton.hidden) restartButton.click();
        }
    };
    const onKeyUp = (event: KeyboardEvent) => {
        if (event.code === 'KeyE') cancelDisarm();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return {
        renderProgress,
        credential(value: GeorgeCredential) { credential = value; codeToggle.hidden = !value || value.status !== 'available'; revealed = false; codeToggle.textContent = 'VIEW PASSWORD · P'; },
        result(result: 'granted' | 'denied' | 'started' | 'not-available', reason?: string) {
            if (result === 'granted') {
                authenticated = true;
                status.textContent = 'ACCESS GRANTED · SERVER CONTROL';
                input.disabled = true;
                loginButton.hidden = true;
                restartButton.hidden = false;
            } else if (result === 'denied' || result === 'not-available') {
                status.textContent = reason ?? 'ACCESS DENIED';
                confirmButton.hidden = true;
                restartButton.hidden = !authenticated;
                loginButton.hidden = !credential;
                input.disabled = false;
            } else {
                closeConsole();
            }
        },
        reboot: renderReboot,
        securityAlert() { alert.hidden = false; window.setTimeout(() => (alert.hidden = true), 4500); },
        shutdown(initiatorId: string, selfId: string) {
            blackout.hidden = false;
            blackout.querySelector('span')!.textContent = initiatorId === selfId ? 'GEORGE PROTOCOL EXECUTED' : 'GEORGE PROTOCOL';
            document.exitPointerLock?.();
            backdrop.hidden = true;
            terminalOpen = false;
            authenticated = false;
        },
        resultScreen(won: boolean) {
            blackout.hidden = false;
            blackout.querySelector('strong')!.textContent = won ? 'VICTORY' : 'DEFEAT';
            blackout.querySelector('span')!.textContent = won ? 'GEORGE PROTOCOL EXECUTED · SERVER REBOOT' : 'GEORGE PROTOCOL · MATCH TERMINATED';
        },
        closeTerminal: closeConsole,
        restoreControls() { closeConsole(); blackout.hidden = true; actions.focus(false); },
        setNearby(value: boolean, selfId = '') {
            nearby = value;
            myId = selfId;
            prompt.hidden = !value || (reboot.phase === 'pending' && reboot.initiatorId === myId);
            prompt.textContent = reboot.phase === 'pending'
                ? 'HOLD E · ABORT SERVER REBOOT'
                : credential?.status === 'available' ? 'E · ACCESS GEORGE’S SERVER' : 'GEORGE’S SERVER · ACCESS RESTRICTED';
            disarmButton.hidden = !(value && reboot.phase === 'pending' && reboot.initiatorId !== myId && (!reboot.disarmerId || reboot.disarmerId === myId));
            if (!value && terminalOpen) closeConsole();
        },
        get near() { return nearby; },
        get credentialAvailable() { return credential?.status === 'available'; },
        get terminalOpen() { return terminalOpen; },
        get rebootState() { return reboot; },
        get disarming() { return disarmRequest !== null; },
        beginDisarm,
        cancelDisarm,
        openTerminal,
        tick(now: number) {
            if (!milestone.hidden && performance.now() >= hideMilestoneAt) milestone.hidden = true;
            const monotonicNow = performance.now();
            if (disarmRequest && monotonicNow - lastDisarmHeartbeatAt >= 150) {
                lastDisarmHeartbeatAt = monotonicNow;
                actions.disarm(requestId());
            }
            if (reboot.phase === 'pending') {
                const seconds = Math.max(0, Math.ceil((reboot.endsAt - now) / 1000));
                const count = rebootEl.querySelector('strong');
                if (seconds !== lastSecond && count) { count.textContent = `00:${String(seconds).padStart(2, '0')}`; lastSecond = seconds; }
                const fill = rebootEl.querySelector<HTMLElement>('.george-disarm-track i');
                if (fill && reboot.disarmStartedAt !== null) fill.style.width = `${Math.min(100, (now - reboot.disarmStartedAt) / 20)}%`;
                else if (fill) fill.style.width = '0%';
            }
        },
        destroy() {
            window.removeEventListener('pointerup', cancelDisarm);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            root.remove();
        }
    };
};
