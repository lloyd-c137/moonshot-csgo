import { Asset, AnimStateGraph, Entity } from 'playcanvas';
import type { AppBase, ContainerResource, AnimTrack, StandardMaterial } from 'playcanvas';

export const CHARACTER_ASSET_URL = '/assets/characters/moonshot-humanoid.glb';
export const CHARACTER_VISUAL_SCALE = 0.33;
export const CHARACTER_VISUAL_HEIGHT = 1.829 * CHARACTER_VISUAL_SCALE;

const clipName = (name: string) => name.split('|').at(-1) ?? name;

/** Shared immutable source container; instances own their entity and cloned materials. */
export class CharacterAssetLoader {
    private readonly resource: ContainerResource;
    private readonly tracks: Map<string, AnimTrack>;

    private constructor(resource: ContainerResource, tracks: Map<string, AnimTrack>) {
        this.resource = resource;
        this.tracks = tracks;
    }

    static load(app: AppBase) {
        return new Promise<CharacterAssetLoader>((resolve, reject) => {
            const asset = new Asset('Moonshot humanoid', 'container', { url: CHARACTER_ASSET_URL });
            asset.once('error', (error: string) => reject(new Error(`Character GLB failed: ${error}`)));
            asset.once('load', () => {
                const resource = asset.resource as
                    (ContainerResource & { animations: { resource?: AnimTrack }[] }) | null;
                if (!resource?.instantiateRenderEntity || !resource.animations?.length) {
                    reject(new Error('Character container is missing its render hierarchy or animation clips'));
                    return;
                }
                const tracks = new Map<string, AnimTrack>();
                for (const animation of resource.animations) {
                    if (animation.resource) tracks.set(clipName(animation.resource.name), animation.resource);
                }
                if (!tracks.has('Idle_Loop') || !tracks.has('Walk_Loop') || !tracks.has('Sprint_Loop')) {
                    reject(new Error('Character container is missing required idle/walk/sprint clips'));
                    return;
                }
                resolve(new CharacterAssetLoader(resource, tracks));
            });
            app.assets.add(asset);
            app.assets.load(asset);
        });
    }

    create(options: {
        name: string;
        colour: [number, number, number];
        materialColours?: Partial<Record<'M_Main' | 'M_Joints' | 'M_Head', [number, number, number]>>;
        castShadows?: boolean;
    }) {
        const modelRoot = this.resource.instantiateRenderEntity({ castShadows: options.castShadows ?? false });
        const root = new Entity(options.name);
        root.name = options.name;
        root.setLocalScale(CHARACTER_VISUAL_SCALE, CHARACTER_VISUAL_SCALE, CHARACTER_VISUAL_SCALE);
        modelRoot.name = `${options.name}-model`;
        root.addChild(modelRoot);
        const materials = new Map<string, StandardMaterial>();
        root.forEach((node) => {
            const render = (node as Entity).render;
            if (!render) return;
            for (const instance of render.meshInstances) {
                const source = instance.material as StandardMaterial;
                let material = materials.get(source.name);
                if (!material) {
                    material = source.clone();
                    material.name = `${source.name}-${options.name}`;
                    const colour =
                        options.materialColours?.[source.name as 'M_Main' | 'M_Joints' | 'M_Head'] ??
                        (source.name === 'M_Main' ? options.colour : null);
                    if (colour) {
                        material.diffuse.set(...colour);
                        material.update();
                    }
                    materials.set(source.name, material);
                }
                instance.material = material;
                instance.castShadow = options.castShadows ?? false;
                instance.receiveShadow = false;
            }
        });
        const armature = (modelRoot.findByName('Armature') as Entity | null) ?? modelRoot;
        modelRoot.addComponent('anim', { activate: true, rootBone: armature });
        const stateNames = [...this.tracks.keys()];
        modelRoot.anim!.loadStateGraph(
            new AnimStateGraph({
                layers: [
                    {
                        name: 'Base',
                        states: [
                            { name: 'START', speed: 1 },
                            ...stateNames.map((name) => ({
                                name,
                                speed: 1,
                                loop: name.endsWith('_Loop') || name.includes('_Loop_'),
                                defaultState: name === 'Idle_Loop'
                            }))
                        ],
                        transitions: [
                            { from: 'START', to: 'Idle_Loop' },
                            ...stateNames
                                .filter((name) => name !== 'Idle_Loop')
                                .map((name) => ({
                                    from: 'ANY',
                                    to: name,
                                    time: 0.12
                                })),
                            { from: 'ANY', to: 'Idle_Loop', time: 0.12 }
                        ]
                    }
                ],
                parameters: {}
            })
        );
        for (const [name, track] of this.tracks)
            modelRoot.anim!.assignAnimation(name, track, 'Base', 1, name.endsWith('_Loop'));
        const tracks = this.tracks;
        return {
            root,
            materials,
            play(name: string, blend = 0.12) {
                if (!tracks.has(name) || modelRoot.anim!.baseLayer!.activeState === name) return;
                modelRoot.anim!.baseLayer!.transition(name, blend);
            },
            dispose() {
                root.destroy();
                for (const material of materials.values()) material.destroy();
            }
        };
    }
}
