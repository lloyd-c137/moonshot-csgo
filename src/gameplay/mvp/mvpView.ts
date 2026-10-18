// End-of-round MVP sequence, seen by everyone at once (from the shared room clock): the arena dims, the round's
// winner (or top scorer on a draw) walks out under a spotlight on the court and celebrates, filmed from in front,
// while the interface shows their card (ui.mvp). GAMEPLAY_AUTHORED.
import type { AppBase, Entity as EntityType } from 'playcanvas';
import { Color, Entity, Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../../characters/CharacterAssetLoader';

type V3 = [number, number, number];

export const MVP = {
    /** Length of the sequence (inside the round intermission). */
    seconds: 8,
    /** Walk-out: from a few metres behind the mark, at this pace, then the celebration. */
    walkFrom: 3.2,
    walkSeconds: 2.2,
    fadeOut: 0.5
} as const;

export const createMvpView = (app: AppBase, playerCamera: EntityType, characters: CharacterAssetLoader, center: [number, number]) => {
    const root = new Entity('GameplayAuthored_RoundMvp');
    app.root.addChild(root);
    const camera = new Entity('round-mvp-camera');
    camera.addComponent('camera');
    camera.camera!.copy(playerCamera.camera!);
    camera.enabled = false;
    app.root.addChild(camera);
    // The stage: the south half of the court, facing north toward the camera.
    const mark: V3 = [center[0], 0, center[1] + 5];
    const spot = new Entity('round-mvp-spot');
    spot.addComponent('light', {
        type: 'spot',
        color: new Color(1, 0.96, 0.88),
        intensity: 0,
        range: 30,
        innerConeAngle: 10,
        outerConeAngle: 16,
        castShadows: false
    });
    spot.setPosition(mark[0] + 1.5, 14, mark[2] - 3);
    root.addChild(spot);
    const fill = new Entity('round-mvp-fill');
    fill.addComponent('light', { type: 'omni', color: new Color(0.55, 0.85, 1), intensity: 0, range: 7, castShadows: false });
    fill.setPosition(mark[0] - 2, 2.2, mark[2] - 2.5);
    root.addChild(fill);
    let actor: { character: ReturnType<CharacterAssetLoader['create']>; holder: EntityType; clip: string } | null = null;

    const clear = () => {
        actor?.character.dispose();
        actor?.holder.destroy();
        actor = null;
    };

    return {
        get running() {
            return camera.enabled;
        },
        start(colour: [number, number, number], head: HTMLImageElement | HTMLCanvasElement | null) {
            clear();
            const character = characters.create({ name: 'round-mvp', colour, castShadows: true });
            if (head) character.setHeadImage(head);
            const holder = new Entity('round-mvp-holder');
            holder.addChild(character.root);
            root.addChild(holder);
            actor = { character, holder, clip: '' };
            playerCamera.enabled = false;
            camera.enabled = true;
        },
        setHead(head: HTMLImageElement | HTMLCanvasElement) {
            actor?.character.setHeadImage(head);
        },
        update(t: number) {
            if (!actor) return;
            const u = Math.max(0, Math.min(1, t / MVP.walkSeconds));
            const eased = 1 - (1 - u) * (1 - u);
            const z = mark[2] + MVP.walkFrom * (1 - eased);
            actor.holder.setPosition(mark[0], 0, z);
            // Walks north toward the camera, then turns a little to the lens for the celebration.
            const turn = Math.max(0, Math.min(1, (t - MVP.walkSeconds) / 0.6));
            actor.holder.setEulerAngles(0, -12 * turn, 0);
            const clip = t < MVP.walkSeconds ? 'Walk_Loop' : t < MVP.walkSeconds + 2.6 ? 'Idle_Wave_Loop' : 'Dance_Loop';
            if (clip !== actor.clip) {
                actor.character.play(clip, 0.3);
                actor.clip = clip;
            }
            // Spot and fill come up as the winner steps into the light.
            const light = Math.min(1, t / 0.8);
            spot.light!.intensity = 7 * light;
            fill.light!.intensity = 1.4 * light;
            spot.lookAt(new Vec3(mark[0], 0.9, z));
            spot.rotateLocal(90, 0, 0);
            // Low and in front, the winner framed to the right of the card; a slow push in.
            const push = Math.min(1, t / MVP.seconds);
            camera.setPosition(mark[0] + 1.1, 1.25, mark[2] - 4.6 + push * 0.9);
            // Keep the actor to the right of the fixed left-side stats card at desktop and laptop viewports.
            camera.lookAt(new Vec3(mark[0] + 1.5, 1.05, z));
            camera.camera!.fov = 46 - push * 4;
        },
        stop() {
            clear();
            spot.light!.intensity = 0;
            fill.light!.intensity = 0;
            camera.enabled = false;
            playerCamera.enabled = true;
        }
    };
};
