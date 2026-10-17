// South gate turnstile logic (pure). Outside, the flaps open for a player walking up and turn green; passing the line
// joins the round in progress. Once inside the flaps stay shut and red, and blink when someone tries to leave.
import { SOUTH_GATE } from '../config/gameplay.ts';

export type GateState = 'lobby' | 'inside';
export type GateLight = 'red' | 'green' | 'denied';

const inOpening = (x: number, margin = 0) => x >= SOUTH_GATE.x0 - margin && x <= SOUTH_GATE.x1 + margin;

/** One step of the gate for the local player at (x, z). `joined` is true exactly on the step that crosses in. */
export const stepGate = (state: GateState, x: number, z: number) => {
    const { line, approach, through } = SOUTH_GATE;
    if (state === 'lobby') {
        const near = inOpening(x, 0.6) && z > line - through && z <= line + approach;
        if (inOpening(x) && z < line - through)
            return { state: 'inside' as GateState, open: false, light: 'red' as GateLight, joined: true };
        return { state, open: near, light: (near ? 'green' : 'red') as GateLight, joined: false };
    }
    const tryingToLeave = inOpening(x, 0.6) && z < line && z >= line - approach;
    return { state, open: false, light: (tryingToLeave ? 'denied' : 'red') as GateLight, joined: false };
};

/** Inside the fenced waiting plaza (outside the gate). */
export const inPlaza = (x: number, z: number) => {
    const { x0, x1, z0, z1 } = SOUTH_GATE.plaza;
    return x >= x0 && x <= x1 && z >= z0 && z <= z1;
};
