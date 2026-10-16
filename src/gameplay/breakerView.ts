// GAMEPLAY_AUTHORED cabinet, attached to the existing SVC-10 interior; source architecture is immutable.
import type { AppBase } from 'playcanvas';
import { Color, Entity, StandardMaterial } from 'playcanvas';

import { BREAKER } from './power';

export const createBreakerView = (app: AppBase) => {
    const cabinet = new Entity('GameplayAuthored_Breaker_SVC-10');
    cabinet.setPosition(...BREAKER.cabinet);
    app.root.addChild(cabinet);
    const body = new StandardMaterial();
    body.diffuse = new Color(0.12, 0.2, 0.21);
    body.update();
    cabinet.addComponent('render', { type: 'box', material: body });
    cabinet.setLocalScale(0.65, 0.85, 0.18);
    const lever = new Entity('breaker-handle');
    const red = new StandardMaterial();
    red.diffuse = new Color(0.9, 0.18, 0.08);
    red.update();
    lever.addComponent('render', { type: 'box', material: red });
    lever.setLocalPosition(0, 0, 0.8);
    lever.setLocalScale(0.16, 0.3, 0.7);
    cabinet.addChild(lever);
    let previous: boolean | null = null;
    return {
        update(off: boolean) {
            if (off === previous) return;
            previous = off;
            lever.setLocalEulerAngles(off ? -35 : 35, 0, 0);
        }
    };
};
