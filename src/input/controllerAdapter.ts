import type { Entity } from 'playcanvas';
import { KeyboardMouseSource } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import { isPhysicallyCrouched } from '../player/crouch.ts';

import { input } from './InputManager';

type DesktopInput = { read: () => { key: number[]; [key: string]: unknown }; destroy: () => void };

/** Remap only desktop key axes while preserving the upstream controller's mouse/mobile/gamepad sources. */
export const adaptDesktopControllerInput = (player: Entity) => {
    const controller = player.script?.get(FirstPersonController) as unknown as { _desktopInput?: DesktopInput & { moonshotRemapped?: true } } | null;
    const source = controller?._desktopInput;
    if (!controller || !source || source.moonshotRemapped) return !!source?.moonshotRemapped;
    controller._desktopInput = {
        moonshotRemapped: true,
        destroy: () => source.destroy(),
        read: () => {
            const frame = source.read();
            frame.key.fill(0);
            const { keyCode } = KeyboardMouseSource;
            frame.key[keyCode.W] = Number(input.isDown('moveForward'));
            frame.key[keyCode.S] = Number(input.isDown('moveBackward'));
            frame.key[keyCode.A] = Number(input.isDown('strafeLeft'));
            frame.key[keyCode.D] = Number(input.isDown('strafeRight'));
            frame.key[keyCode.SPACE] = Number(input.isDown('jump') && !isPhysicallyCrouched());
            frame.key[keyCode.SHIFT] = Number(input.isDown('sprint') && !isPhysicallyCrouched());
            return frame;
        }
    };
    return true;
};
