export type CameraMotion = 'off' | 'low' | 'normal';

type Impulse = { age: number; strength: number; phase: number };

/** Short, deterministic local camera offsets; it never changes the player's look angles or world movement. */
export class CameraImpulseController {
    private readonly impulses: Impulse[] = [];
    private mode: CameraMotion = 'low';
    private sequence = 0;

    setMode(mode: CameraMotion) {
        this.mode = mode;
        if (mode === 'off') this.impulses.length = 0;
    }

    get scale() {
        return this.mode === 'off' ? 0 : this.mode === 'low' ? 0.38 : 1;
    }

    trigger(strength: number) {
        if (this.mode === 'off') return;
        if (this.impulses.length >= 8) {
            const weakest = this.impulses.reduce((lowest, item, index, all) =>
                item.strength < all[lowest].strength ? index : lowest
            , 0);
            this.impulses.splice(weakest, 1);
        }
        this.sequence++;
        this.impulses.push({
            age: 0,
            strength: Math.max(0, Math.min(1, strength)),
            phase: (this.sequence * 2.399963229728653) % (Math.PI * 2)
        });
    }

    update(deltaTime: number): [number, number] {
        if (this.mode === 'off') return [0, 0];
        let x = 0;
        let y = 0;
        const scale = this.scale;
        for (let index = this.impulses.length - 1; index >= 0; index--) {
            const impulse = this.impulses[index];
            impulse.age += Math.max(0, deltaTime);
            const envelope = Math.exp(-impulse.age * 9);
            x += Math.sin(impulse.age * 42 + impulse.phase) * envelope * impulse.strength * 0.025 * scale;
            y += Math.sin(impulse.age * 56 + impulse.phase + 1.1) * envelope * impulse.strength * 0.015 * scale;
            if (impulse.age > 0.7 || envelope < 0.002) this.impulses.splice(index, 1);
        }
        return [Math.max(-0.035, Math.min(0.035, x)), Math.max(-0.02, Math.min(0.02, y))];
    }
}
