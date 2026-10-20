export const ACTIONS = [
    'moveForward', 'moveBackward', 'strafeLeft', 'strafeRight', 'sprint', 'jump', 'crouch',
    'throw', 'cancelThrow', 'spectateNext', 'inspect', 'interact', 'execute', 'activeSkill', 'chat',
    'map', 'scoreboard', 'recover', 'unstuck', 'emote1', 'emote2', 'emote3', 'skipCutscene'
] as const;

export type InputAction = (typeof ACTIONS)[number];
export type Binding = string;
export type KeyBindings = Record<InputAction, Binding>;

/** Auditable controls matrix used by tests and the settings UI. Contexts describe where dispatch is allowed. */
export const INPUT_ACTION_MATRIX: readonly {
    action: InputAction;
    context: 'gameplay' | 'chat' | 'spectator' | 'cutscene';
    activation: 'hold' | 'press' | 'press-release';
    consumers: readonly string[];
}[] = [
    ...(['moveForward', 'moveBackward', 'strafeLeft', 'strafeRight'] as const).map((action) => ({ action, context: 'gameplay' as const, activation: 'hold' as const, consumers: ['src/input/controllerAdapter.ts', 'src/player/stepAssist.ts'] })),
    ...(['sprint', 'jump'] as const).map((action) => ({ action, context: 'gameplay' as const, activation: 'hold' as const, consumers: ['src/input/controllerAdapter.ts'] })),
    { action: 'crouch', context: 'gameplay', activation: 'hold', consumers: ['src/player/crouch.ts'] },
    { action: 'throw', context: 'gameplay', activation: 'press-release', consumers: ['src/gameplay/match.ts'] },
    { action: 'cancelThrow', context: 'gameplay', activation: 'press', consumers: ['src/gameplay/match.ts'] },
    { action: 'spectateNext', context: 'spectator', activation: 'press', consumers: ['src/gameplay/match.ts'] },
    { action: 'inspect', context: 'gameplay', activation: 'press', consumers: ['src/gameplay/match.ts'] },
    { action: 'interact', context: 'gameplay', activation: 'press', consumers: ['src/gameplay/match.ts'] },
    { action: 'execute', context: 'gameplay', activation: 'press-release', consumers: ['src/gameplay/match.ts'] },
    { action: 'activeSkill', context: 'gameplay', activation: 'press', consumers: ['src/main.ts'] },
    { action: 'chat', context: 'gameplay', activation: 'press', consumers: ['src/main.ts'] },
    { action: 'map', context: 'gameplay', activation: 'press', consumers: ['src/main.ts'] },
    { action: 'scoreboard', context: 'gameplay', activation: 'press-release', consumers: ['src/gameplay/match.ts'] },
    { action: 'recover', context: 'gameplay', activation: 'press', consumers: ['src/main.ts'] },
    { action: 'unstuck', context: 'gameplay', activation: 'press', consumers: ['src/main.ts'] },
    { action: 'emote1', context: 'spectator', activation: 'press', consumers: ['src/gameplay/match.ts'] },
    { action: 'emote2', context: 'spectator', activation: 'press', consumers: ['src/gameplay/match.ts'] },
    { action: 'emote3', context: 'spectator', activation: 'press', consumers: ['src/gameplay/match.ts'] },
    { action: 'skipCutscene', context: 'cutscene', activation: 'press', consumers: ['src/gameplay/match.ts'] }
];

export const DEFAULT_BINDINGS: KeyBindings = {
    moveForward: 'KeyW', moveBackward: 'KeyS', strafeLeft: 'KeyA', strafeRight: 'KeyD',
    sprint: 'ShiftLeft', jump: 'Space', crouch: 'KeyC', throw: 'MouseLeft', cancelThrow: 'MouseRight', spectateNext: 'MouseLeft',
    inspect: 'KeyF', interact: 'KeyE', execute: 'KeyV', activeSkill: 'Enter', chat: 'KeyT',
    map: 'KeyM', scoreboard: 'Tab', recover: 'KeyR', unstuck: 'KeyG', emote1: 'Digit1',
    emote2: 'Digit2', emote3: 'Digit3', skipCutscene: 'Space'
};

export const conflictsFor = (bindings: KeyBindings, action: InputAction, code: Binding) =>
    ACTIONS.filter((candidate) => {
        if (candidate === action || candidate === 'skipCutscene' || action === 'skipCutscene') return false;
        if ((candidate === 'spectateNext' && action === 'throw') || (candidate === 'throw' && action === 'spectateNext')) return false;
        return bindings[candidate] === code;
    });

const RESERVED_BINDINGS = new Set([
    'Escape', 'Backspace', 'Delete', 'F5', 'F11', 'F12', 'ContextMenu', 'PrintScreen',
    'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'
]);

export const isSafeBinding = (code: Binding) =>
    /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(code) && !RESERVED_BINDINGS.has(code) && !code.startsWith('Browser');

export const setBinding = (bindings: KeyBindings, action: InputAction, code: Binding, swap = false): KeyBindings | null => {
    if (!isSafeBinding(code)) return null;
    const conflicts = conflictsFor(bindings, action, code);
    if (conflicts.length && !swap) return null;
    const next = { ...bindings };
    if (swap && conflicts.length) next[conflicts[0]] = bindings[action];
    next[action] = code;
    return next;
};
