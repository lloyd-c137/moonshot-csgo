// Entry flyover (Call of Duty style): on the first entry into the campus a cinematic camera flies the path in
// introPath.ts while a title card types itself out, then blends into the player's own eyes. Any click, Space,
// Enter or Escape skips it. Uses its own long-range camera; the sky dome is enlarged while it runs.
import { Entity, Vec3 } from 'playcanvas';
import type { AppBase, Entity as EntityType } from 'playcanvas';

import { INTRO_DURATION, introCamera, introLines } from './introPath';

export type IntroUi = {
    intro: (lines: string[] | null) => void;
};

export const createIntro = (app: AppBase, playerCamera: EntityType, ui: IntroUi) => {
    const camera = new Entity('intro-camera');
    camera.addComponent('camera');
    camera.camera!.copy(playerCamera.camera!);
    camera.camera!.nearClip = 0.3;
    camera.camera!.farClip = 1200;
    camera.enabled = false;
    app.root.addChild(camera);
    let startedAt: number | null = null;
    let finish: (() => void) | null = null;
    const look = new Vec3();

    const end = () => {
        if (startedAt === null) return;
        startedAt = null;
        camera.enabled = false;
        playerCamera.enabled = true;
        app.root.findByName('sky-dome')?.setLocalScale(1, 1, 1);
        ui.intro(null);
        const done = finish;
        finish = null;
        done?.();
    };
    const skip = (event: Event) => {
        if (startedAt === null) return;
        if (event instanceof KeyboardEvent && !['Space', 'Enter', 'Escape'].includes(event.code)) return;
        if (event instanceof KeyboardEvent && event.code !== 'Escape') event.preventDefault();
        end();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('mousedown', skip);
    document.addEventListener('pointerlockchange', () => {
        if (!document.pointerLockElement) end();
    });

    app.on('update', () => {
        if (startedAt === null) return;
        const seconds = (performance.now() - startedAt) / 1000;
        const eye = playerCamera.getPosition();
        const forward = playerCamera.forward;
        const view = introCamera(
            seconds,
            [eye.x, eye.y, eye.z],
            [eye.x + forward.x, eye.y + forward.y, eye.z + forward.z],
            playerCamera.camera!.fov
        );
        camera.setPosition(view.pos[0], view.pos[1], view.pos[2]);
        look.set(view.look[0], view.look[1], view.look[2]);
        camera.lookAt(look);
        camera.camera!.fov = view.fov;
        if (seconds >= INTRO_DURATION) end();
    });

    return {
        /** Plays the flyover once; `done` runs when it ends or is skipped. */
        play(done: () => void) {
            if (startedAt !== null) return;
            finish = done;
            startedAt = performance.now();
            // The dome follows the player camera; scaled up it stays behind the whole campus in the aerial shots.
            app.root.findByName('sky-dome')?.setLocalScale(6, 6, 6);
            playerCamera.enabled = false;
            camera.enabled = true;
            ui.intro(introLines(new Date()));
        },
        get active() {
            return startedAt !== null;
        }
    };
};
