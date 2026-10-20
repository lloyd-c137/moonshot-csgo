import { DEFAULT_BINDINGS } from './actions.ts';
import type { InputAction, KeyBindings } from './actions.ts';

const editable = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'));

/** One physical-input state source for gameplay actions; bindings use KeyboardEvent.code or Mouse* names. */
export class InputManager {
    bindings: KeyBindings = { ...DEFAULT_BINDINGS };
    private down = new Set<string>();
    private framePressed = new Set<string>();
    private frameReleased = new Set<string>();
    private pendingPressed = new Set<string>();
    private pendingReleased = new Set<string>();
    private recorder: ((code: string) => void) | null = null;
    private recorderCancel: (() => void) | null = null;

    private readonly target: Window | null;
    get isRecording() { return this.recorder !== null; }

    constructor(target: Window | null = typeof window === 'undefined' ? null : window) {
        this.target = target;
        target?.addEventListener('keydown', this.onKeyDown);
        target?.addEventListener('keyup', this.onKeyUp);
        target?.addEventListener('mousedown', this.onMouseDown);
        target?.addEventListener('mouseup', this.onMouseUp);
        target?.addEventListener('blur', this.releaseAll);
        target?.document.addEventListener('visibilitychange', this.onVisibility);
        target?.document.addEventListener('pointerlockchange', this.onPointerLock);
    }

    private onKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
        if (this.recorder) {
            if (event.code === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.cancelRecording();
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            const recorder = this.recorder;
            this.recorder = null;
            this.recorderCancel = null;
            recorder(event.code);
            this.releaseAll();
            return;
        }
        if (event.repeat) return;
        this.press(event.code);
    };

    private onKeyUp = (event: KeyboardEvent) => this.release(event.code);
    private onMouseDown = (event: MouseEvent) => {
        if (this.recorder) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const recorder = this.recorder;
            this.recorder = null;
            this.recorderCancel = null;
            recorder(['MouseLeft', 'MouseMiddle', 'MouseRight'][event.button] ?? '');
            this.releaseAll();
            return;
        }
        if (!editable(event.target)) this.press(['MouseLeft', 'MouseMiddle', 'MouseRight'][event.button] ?? '');
    };
    private onMouseUp = (event: MouseEvent) => this.release(['MouseLeft', 'MouseMiddle', 'MouseRight'][event.button] ?? '');
    private onVisibility = () => { if (this.target?.document.hidden) this.releaseAll(); };
    private onPointerLock = () => { if (!this.target?.document.pointerLockElement) this.releaseAll(); };

    private press(code: string) {
        if (!code || this.down.has(code)) return;
        this.down.add(code);
        this.pendingPressed.add(code);
    }
    private release(code: string) {
        if (this.down.delete(code)) this.pendingReleased.add(code);
    }
    releaseAll = () => {
        for (const code of this.down) this.pendingReleased.add(code);
        this.down.clear();
    };

    isDown(action: InputAction) { return this.down.has(this.bindings[action]); }
    wasPressed(action: InputAction) { return this.framePressed.has(this.bindings[action]); }
    wasReleased(action: InputAction) { return this.frameReleased.has(this.bindings[action]); }
    matchesKey(event: KeyboardEvent, action: InputAction) {
        return !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && event.code === this.bindings[action];
    }
    matchesMouse(event: MouseEvent, action: InputAction) {
        return this.bindings[action] === (['MouseLeft', 'MouseMiddle', 'MouseRight'][event.button] ?? '');
    }
    beginFrame() {
        const pressed = this.framePressed;
        this.framePressed = this.pendingPressed;
        this.pendingPressed = pressed;
        this.pendingPressed.clear();
        const released = this.frameReleased;
        this.frameReleased = this.pendingReleased;
        this.pendingReleased = released;
        this.pendingReleased.clear();
    }
    record(next: (code: string) => void, onCancel?: () => void) { this.releaseAll(); this.recorder = next; this.recorderCancel = onCancel ?? null; }
    cancelRecording() { const cancel = this.recorderCancel; this.recorder = null; this.recorderCancel = null; cancel?.(); }
    setBindings(bindings: KeyBindings) { this.releaseAll(); this.bindings = { ...bindings }; }
    destroy() {
        this.releaseAll();
        this.target?.removeEventListener('keydown', this.onKeyDown);
        this.target?.removeEventListener('keyup', this.onKeyUp);
        this.target?.removeEventListener('mousedown', this.onMouseDown);
        this.target?.removeEventListener('mouseup', this.onMouseUp);
        this.target?.removeEventListener('blur', this.releaseAll);
        this.target?.document.removeEventListener('visibilitychange', this.onVisibility);
        this.target?.document.removeEventListener('pointerlockchange', this.onPointerLock);
    }
}

export const input = new InputManager();
