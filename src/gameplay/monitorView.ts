// GAMEPLAY_AUTHORED computer on the desk whose anchor comes from the derived S103 room layout.
import type { AppBase } from 'playcanvas';
import { Color, Entity, StandardMaterial } from 'playcanvas';

import { MONITOR_CONSOLE } from '../config/specialLocations.ts';

export const createMonitorView = (app: AppBase) => {
    const desk = new Entity('GameplayAuthored_Monitor_Desk_Computer');
    desk.setPosition(MONITOR_CONSOLE.x, 0.74, MONITOR_CONSOLE.z);
    app.root.addChild(desk);
    const dark = new StandardMaterial();
    dark.diffuse = new Color(0.07, 0.09, 0.1);
    dark.update();
    const screenMaterial = new StandardMaterial();
    screenMaterial.diffuse = new Color(0.12, 0.3, 0.31);
    screenMaterial.emissive = new Color(0.08, 0.65, 0.72);
    screenMaterial.emissiveIntensity = 0.8;
    screenMaterial.update();
    const base = new Entity('Computer_Base');
    base.addComponent('render', { type: 'box', material: dark });
    base.setLocalPosition(0, 0.025, 0);
    base.setLocalScale(0.46, 0.05, 0.25);
    desk.addChild(base);
    const monitor = new Entity('Computer_Screen');
    monitor.addComponent('render', { type: 'box', material: screenMaterial });
    monitor.setLocalPosition(0, 0.27, -0.07);
    monitor.setLocalScale(0.38, 0.27, 0.035);
    desk.addChild(monitor);
    const stand = new Entity('Computer_Stand');
    stand.addComponent('render', { type: 'box', material: dark });
    stand.setLocalPosition(0, 0.12, -0.07);
    stand.setLocalScale(0.055, 0.18, 0.05);
    desk.addChild(stand);
    let active: boolean | null = null;
    return {
        setActive(next: boolean) {
            if (next === active) return;
            active = next;
            screenMaterial.emissiveIntensity = next ? 2.2 : 0.8;
            screenMaterial.update();
        }
    };
};
