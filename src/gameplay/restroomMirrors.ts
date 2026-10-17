import type { AppBase, Entity as EntityType } from 'playcanvas';
import {
    ADDRESS_CLAMP_TO_EDGE,
    ASPECT_MANUAL,
    Color,
    Entity,
    FILTER_LINEAR,
    Layer,
    PIXELFORMAT_SRGBA8,
    RENDERTARGET_ORIGIN_TOP,
    RenderTarget,
    Texture,
    Vec3
} from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import type { Auth } from '../net/auth';
import type { PlayerPose } from '../net/protocol';
import type { RestroomMirrorMount } from '../world/dressing';

import { hueColour } from './discs';

/** One low-resolution reflection camera is enabled only while the player faces a nearby restroom mirror. */
export const createRestroomMirrors = (
    app: AppBase,
    sourceCamera: EntityType,
    mounts: RestroomMirrorMount[],
    surfaceLayer: Layer,
    characters: CharacterAssetLoader,
    auth: Auth,
    colour: () => number
) => {
    const world = app.scene.layers.getLayerByName('World');
    const characterLayer = new Layer({ name: 'Restroom_Mirror_Character' });
    app.scene.layers.insert(characterLayer, world ? app.scene.layers.getOpaqueIndex(world) + 1 : 0);
    app.root.forEach((node) => {
        const light = (node as EntityType).light;
        if (light) characterLayer.addLight(light);
    });
    const cameraLayers = [...sourceCamera.camera!.layers];
    if (!cameraLayers.includes(surfaceLayer.id)) sourceCamera.camera!.layers = [...cameraLayers, surfaceLayer.id];

    const texture = new Texture(app.graphicsDevice, {
        name: 'Restroom_Mirror_Reflection',
        width: 256,
        height: 512,
        format: PIXELFORMAT_SRGBA8,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });
    const target = new RenderTarget({ colorBuffer: texture, depth: true, origin: RENDERTARGET_ORIGIN_TOP });
    const mirrorCamera = new Entity('Restroom_Mirror_Camera');
    mirrorCamera.addComponent('camera', {
        enabled: false,
        priority: -1,
        renderTarget: target,
        // The virtual camera is on the far side of the mirror plane. Render only the player clone so the
        // architectural wall behind the mirror cannot occlude the reflected body.
        layers: [characterLayer.id],
        clearColor: new Color(0.12, 0.15, 0.17),
        clearColorBuffer: true,
        clearDepthBuffer: true,
        fov: 78,
        nearClip: 0.08,
        farClip: 100,
        aspectRatioMode: ASPECT_MANUAL,
        aspectRatio: 0.5
    });
    app.root.addChild(mirrorCamera);

    const reflection = new Entity('Restroom_Mirror_Player_Reflection');
    const character = characters.create({
        name: 'mirror-player-rig',
        colour: hueColour(colour()),
        castShadows: false
    });
    reflection.addChild(character.root);
    character.root.setLocalPosition(0, -0.9, 0);
    reflection.enabled = false;
    reflection.forEach((node) => {
        const render = (node as EntityType).render;
        if (render) render.layers = [characterLayer.id];
    });
    app.root.addChild(reflection);

    let active: RestroomMirrorMount | null = null;
    const mirrorNormal = new Vec3();
    const cameraPosition = new Vec3();
    const mirrorCenter = new Vec3();
    const toMirror = new Vec3();
    let avatarRequest = 0;
    let avatarKey = '';
    let locomotion = 'Idle_Loop';
    const setAvatar = (id: string | null | undefined, version: string | null | undefined) => {
        const key = id && version ? `${id}:${version}` : '';
        if (key === avatarKey) return;
        avatarKey = key;
        const request = ++avatarRequest;
        if (!key) {
            character.setHeadImage(null);
            return;
        }
        const url = auth.avatarUrl(id!, version!);
        if (!url) return;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = url;
        void image
            .decode()
            .then(() => {
                if (request === avatarRequest && avatarKey === key) character.setHeadImage(image);
            })
            .catch(() => {
                if (request === avatarRequest) character.setHeadImage(null);
            });
    };
    const setColour = (hue: number) => {
        const material = character.materials.get('M_Main');
        if (!material) return;
        material.diffuse.set(...hueColour(hue));
        material.update();
    };
    setAvatar(auth.account?.avatarId, auth.account?.avatarVersion);

    const chooseMirror = (cameraForward: Vec3) => {
        const eye = sourceCamera.getPosition();
        let nearest: RestroomMirrorMount | null = null;
        let best = Infinity;
        for (const mount of mounts) {
            mirrorCenter.set(mount.position[0], mount.position[1] + mount.height / 2, mount.position[2]);
            mirrorNormal.set(...mount.normal);
            toMirror.copy(mirrorCenter).sub(eye);
            const distance = toMirror.length();
            if (distance > 7 || distance < 0.35 || toMirror.dot(cameraForward) / distance < 0.25) continue;
            if (eye.clone().sub(mirrorCenter).dot(mirrorNormal) <= 0.2) continue;
            if (distance < best) {
                nearest = mount;
                best = distance;
            }
        }
        return nearest;
    };

    const update = (pose: PlayerPose, cameraForward: Vec3, visible: boolean, horizontalSpeed: number) => {
        const selected = visible ? chooseMirror(cameraForward) : null;
        if (selected !== active) {
            if (active) {
                active.material.diffuseMap = null;
                active.material.update();
            }
            active = selected;
            if (active) {
                active.material.diffuse.set(1, 1, 1);
                active.material.useLighting = false;
                active.material.diffuseMap = texture;
                active.material.update();
            }
            mirrorCamera.camera!.enabled = !!active;
            reflection.enabled = !!active;
        }
        if (!active) return;

        reflection.setPosition(pose.p[0], pose.p[1], pose.p[2]);
        reflection.setEulerAngles(0, pose.yaw, 0);
        const nextLocomotion =
            horizontalSpeed > 5.5 ? 'Sprint_Loop' : horizontalSpeed > 0.25 ? 'Walk_Loop' : 'Idle_Loop';
        if (nextLocomotion !== locomotion) {
            locomotion = nextLocomotion;
            character.play(locomotion);
        }
        mirrorCenter.set(active.position[0], active.position[1] + active.height / 2, active.position[2]);
        mirrorNormal.set(...active.normal);
        cameraPosition.copy(sourceCamera.getPosition());
        const planeDistance = cameraPosition.clone().sub(mirrorCenter).dot(mirrorNormal);
        const virtualPosition = cameraPosition.sub(mirrorNormal.clone().mulScalar(2 * planeDistance));
        mirrorCamera.setPosition(virtualPosition);
        // Centre the portrait on the full 2.10 m mannequin so its feet remain visible in the narrow restroom mirror.
        mirrorCamera.lookAt(new Vec3(pose.p[0], pose.p[1] + 0.08, pose.p[2]), Vec3.UP);
    };

    return {
        update,
        setAvatar,
        setColour,
        activeRoom: () => active?.roomId ?? null,
        state: () => ({
            activeRoom: active?.roomId ?? null,
            cameraEnabled: mirrorCamera.camera!.enabled,
            reflectionEnabled: reflection.enabled,
            headTextured: character.hasHeadImage()
        }),
        character,
        dispose() {
            mirrorCamera.destroy();
            reflection.destroy();
            character.dispose();
            target.destroy();
            texture.destroy();
            app.scene.layers.remove(characterLayer);
        }
    };
};
