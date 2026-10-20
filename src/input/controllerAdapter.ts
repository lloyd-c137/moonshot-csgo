import type { Entity } from 'playcanvas';
import { KeyboardMouseSource } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import { isPhysicallyCrouched } from '../player/crouch.ts';

import { input } from './InputManager.ts';

type DesktopInput = { read: () => { key: number[]; [key: string]: unknown }; destroy: () => void };

/** The upstream controller accumulates key deltas, so a held action emits only its edges. */
export const applyKeyboardStateDeltas = (
    key: number[],
    states: readonly number[],
    previous: number[],
    slots: readonly number[]
) => {
    key.fill(0);
    for (let i = 0; i < slots.length; i++) {
        key[slots[i]] = states[i] - previous[i];
        previous[i] = states[i];
    }
};

/** Remap only desktop key axes while preserving the upstream controller's mouse/mobile/gamepad sources. */
export const adaptDesktopControllerInput = (player: Entity) => {
    const controller = player.script?.get(FirstPersonController) as unknown as { _desktopInput?: DesktopInput & { moonshotRemapped?: true } } | null;
    const source = controller?._desktopInput;
    if (!controller || !source || source.moonshotRemapped) return !!source?.moonshotRemapped;
    const { keyCode } = KeyboardMouseSource;
    const previous = Array(6).fill(0) as number[];
    const slots = [keyCode.W, keyCode.S, keyCode.A, keyCode.D, keyCode.SPACE, keyCode.SHIFT];
    controller._desktopInput = {
        moonshotRemapped: true,
        destroy: () => source.destroy(),
        read: () => {
            const frame = source.read();
            applyKeyboardStateDeltas(frame.key, [
                Number(input.isDown('moveForward')),
                Number(input.isDown('moveBackward')),
                Number(input.isDown('strafeLeft')),
                Number(input.isDown('strafeRight')),
                Number(input.isDown('jump') && !isPhysicallyCrouched()),
                Number(input.isDown('sprint') && !isPhysicallyCrouched())
            ], previous, slots);
            return frame;
        }
    };
    return true;
};
