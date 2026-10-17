import {
    ADDRESS_CLAMP_TO_EDGE,
    ADDRESS_REPEAT,
    ANIM_LAYER_ADDITIVE,
    Asset,
    AnimStateGraph,
    Entity,
    Texture
} from 'playcanvas';
import type { AppBase, ContainerResource, AnimTrack, GraphicsDevice, StandardMaterial } from 'playcanvas';

import {
    createFrisbeeThrowTrack,
    FRISBEE_THROW_DURATION,
    FRISBEE_THROW_RELEASE_OFFSET,
    FRISBEE_THROW_REMAINING
} from './frisbeeThrowTrack.ts';

export const CHARACTER_ASSET_URL = '/assets/characters/moonshot-humanoid.glb';
export const CHARACTER_SOURCE_HEIGHT = 1.829;
export const CHARACTER_VISUAL_HEIGHT = 2.1;
export const CHARACTER_VISUAL_SCALE = CHARACTER_VISUAL_HEIGHT / CHARACTER_SOURCE_HEIGHT;

export const characterMaterialColour = (
    name: string,
    colour: [number, number, number],
    overrides: Partial<Record<'M_Main' | 'M_Joints' | 'M_Head', [number, number, number]>> = {}
) =>
    overrides[name as 'M_Main' | 'M_Joints' | 'M_Head'] ??
    // Players read as one solid figure: body, joints and the bare head all take the player colour.
    (name === 'M_Main' || name === 'M_Joints' || name === 'M_Head' ? colour : null);

const clipName = (name: string) => name.split('|').at(-1) ?? name;

/** Shared immutable source container; instances own their entity and cloned materials. */
export class CharacterAssetLoader {
    private readonly resource: ContainerResource;
    private readonly tracks: Map<string, AnimTrack>;
    private readonly frisbeeThrowTrack: AnimTrack;
    private readonly device: GraphicsDevice;

    private constructor(
        resource: ContainerResource,
        tracks: Map<string, AnimTrack>,
        frisbeeThrowTrack: AnimTrack,
        device: GraphicsDevice
    ) {
        this.resource = resource;
        this.tracks = tracks;
        this.frisbeeThrowTrack = frisbeeThrowTrack;
        this.device = device;
    }

    static load(app: AppBase) {
        return new Promise<CharacterAssetLoader>((resolve, reject) => {
            const asset = new Asset('Moonshot humanoid', 'container', { url: CHARACTER_ASSET_URL });
            asset.once('error', (error: string) => reject(new Error(`Character GLB failed: ${error}`)));
            asset.once('load', () => {
                const resource = asset.resource as
                    | (ContainerResource & { animations: { resource?: AnimTrack }[] })
                    | null;
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
                resolve(new CharacterAssetLoader(resource, tracks, createFrisbeeThrowTrack(), app.graphicsDevice));
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
        gripRightHand?: boolean;
    }) {
        const modelRoot = this.resource.instantiateRenderEntity({ castShadows: options.castShadows ?? false });
        const root = new Entity(options.name);
        root.name = options.name;
        root.setLocalScale(CHARACTER_VISUAL_SCALE, CHARACTER_VISUAL_SCALE, CHARACTER_VISUAL_SCALE);
        modelRoot.name = `${options.name}-model`;
        root.addChild(modelRoot);
        const materials = new Map<string, StandardMaterial>();
        const baseColours = new Map<string, [number, number, number]>();
        root.forEach((node) => {
            const render = (node as Entity).render;
            if (!render) return;
            for (const instance of render.meshInstances) {
                const source = instance.material as StandardMaterial;
                let material = materials.get(source.name);
                if (!material) {
                    material = source.clone();
                    material.name = `${source.name}-${options.name}`;
                    const colour = characterMaterialColour(source.name, options.colour, options.materialColours);
                    if (colour) {
                        material.diffuse.set(...colour);
                        material.update();
                        baseColours.set(source.name, colour);
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
        const gripBones = ['thumb_01_r', 'index_01_r', 'middle_01_r', 'ring_01_r', 'pinky_01_r']
            .map((name) => modelRoot.findByName(name) as Entity | null)
            .filter((bone): bone is Entity => bone !== null);
        const gripMask = Object.fromEntries(
            gripBones.map((bone) => {
                const relativePath = bone.path.slice(armature.path.length + 1);
                return [`${armature.name}/${relativePath}`, { children: true }];
            })
        );
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
                                .filter(
                                    (name) =>
                                        name !== 'Idle_Loop' && !name.endsWith('_Loop') && !name.includes('_Loop_')
                                )
                                .map((name) => ({
                                    from: name,
                                    to: 'Idle_Loop',
                                    time: 0.12,
                                    exitTime: 0.98
                                }))
                        ]
                    },
                    ...(options.gripRightHand && this.tracks.has('Pistol_Idle_Loop') && gripBones.length === 5
                        ? [
                              {
                                  name: 'RightHandGrip',
                                  mask: gripMask,
                                  states: [
                                      { name: 'START', speed: 1 },
                                      { name: 'Pistol_Idle_Loop', speed: 1, loop: true, defaultState: true }
                                  ],
                                  transitions: [{ from: 'START', to: 'Pistol_Idle_Loop' }]
                              }
                          ]
                        : [])
                ],
                parameters: {}
            })
        );
        for (const [name, track] of this.tracks)
            modelRoot.anim!.assignAnimation(name, track, 'Base', 1, name.endsWith('_Loop'));
        let throwLayer: ReturnType<NonNullable<typeof modelRoot.anim>['addLayer']> | null = null;
        const throwMaskBone = modelRoot.findByName('spine_02') as Entity | null;
        if (throwMaskBone) {
            const relativePath = throwMaskBone.path.slice(armature.path.length + 1);
            // Runtime binder consumes a path-tree object; the published addLayer declaration incorrectly types it as an array.
            throwLayer = modelRoot.anim!.addLayer(
                'FrisbeeThrow',
                0,
                { [`${armature.name}/${relativePath}`]: { children: true } } as unknown as object[],
                ANIM_LAYER_ADDITIVE
            );
            throwLayer.assignAnimation('Frisbee_Throw', this.frisbeeThrowTrack, 1, false);
        }
        if (options.gripRightHand && this.tracks.has('Pistol_Idle_Loop') && gripBones.length === 5)
            modelRoot.anim!.assignAnimation(
                'Pistol_Idle_Loop',
                this.tracks.get('Pistol_Idle_Loop')!,
                'RightHandGrip',
                1,
                true
            );
        const tracks = this.tracks;
        const device = this.device;
        let visualScale = CHARACTER_VISUAL_SCALE;
        let throwTimer = 0;
        let headTexture: Texture | null = null;
        let disposed = false;
        return {
            root,
            materials,
            get height() {
                return CHARACTER_SOURCE_HEIGHT * visualScale;
            },
            duration(name: string) {
                return name === 'Frisbee_Throw' ? FRISBEE_THROW_DURATION : (tracks.get(name)?.duration ?? 0);
            },
            setScale(scale: number) {
                visualScale = Math.max(0.2, Math.min(1.2, scale));
                root.setLocalScale(visualScale, visualScale, visualScale);
            },
            play(name: string, blend = 0.12) {
                const layer = modelRoot.anim!.baseLayer!;
                if (!tracks.has(name) || layer.activeState === name) return;
                layer.transition(name, blend);
            },
            playThrow() {
                if (!throwLayer || disposed) return;
                window.clearTimeout(throwTimer);
                throwLayer.transition('Frisbee_Throw', 0.045, FRISBEE_THROW_RELEASE_OFFSET);
                throwLayer.blendToWeight(1, 0.06);
                throwTimer = window.setTimeout(
                    () => {
                        if (!disposed) throwLayer?.blendToWeight(0, 0.14);
                    },
                    Math.max(0, (FRISBEE_THROW_REMAINING - 0.12) * 1000)
                );
            },
            stopThrow() {
                window.clearTimeout(throwTimer);
                throwLayer?.blendToWeight(0, 0.05);
            },
            setHeadImage(image: HTMLImageElement | HTMLCanvasElement | null) {
                const material = materials.get('M_Head');
                if (!material || disposed) return;
                headTexture?.destroy();
                headTexture = null;
                material.diffuseMap = null;
                const base = baseColours.get('M_Head');
                if (base) material.diffuse.set(...base);
                if (image) {
                    headTexture = new Texture(device, {
                        name: `${options.name}-head-avatar`,
                        width: image.width,
                        height: image.height,
                        addressU: ADDRESS_REPEAT,
                        addressV: ADDRESS_CLAMP_TO_EDGE,
                        mipmaps: true
                    });
                    headTexture.setSource(image);
                    material.diffuse.set(1, 1, 1);
                    material.diffuseMap = headTexture;
                }
                material.update();
            },
            hasHeadImage() {
                return headTexture !== null;
            },
            dispose() {
                disposed = true;
                window.clearTimeout(throwTimer);
                headTexture?.destroy();
                root.destroy();
                for (const material of materials.values()) material.destroy();
            }
        };
    }
}
