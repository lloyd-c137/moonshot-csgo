import type { AppBase, Entity } from 'playcanvas';
import { Asset } from 'playcanvas';

export const CAMPUS_ASSET_URL = '/assets/campus/MAC_Campus_FF01.glb';
export const REQUIRED_SOURCE_NODES = ['Floor_Slab', 'Walls', 'Walls_Top', 'Glazing', 'Arena_Court', 'Arena_StandBase'];

export type CampusLoadResult = {
    root: Entity;
    modelId: string;
    status: string;
};

export const loadCampus = (app: AppBase, onProgress: (progress: number) => void) =>
    new Promise<CampusLoadResult>((resolve, reject) => {
        const asset = new Asset('FF-01 campus', 'container', { url: CAMPUS_ASSET_URL });
        asset.on('progress', (received: number, total: number) => {
            if (total > 0) onProgress(received / total);
        });
        asset.once('error', (error: string) => reject(new Error(`FF-01 GLB failed: ${error}`)));
        asset.once('load', () => {
            try {
                const resource = asset.resource;
                if (!resource) throw new Error('FF-01 container has no resource');
                const root = resource.instantiateRenderEntity();
                const modelId = 'FF01-CAMPUS-3D-V1';
                const status = 'SOURCE_DERIVED_3D_UNVERIFIED';
                const scale = root.getLocalScale();
                if (root.name !== 'MAC_Campus_FF01') throw new Error(`Unexpected model root: ${root.name}`);
                if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
                    throw new Error('FF-01 root scale must remain 1:1');
                }
                for (const name of REQUIRED_SOURCE_NODES) {
                    if (!root.findByName(name)) throw new Error(`FF-01 model is missing required node: ${name}`);
                }
                root.findByName('Rooms')!.enabled = false;
                root.findByName('FloorLines')!.enabled = false;
                root.findByName('LabelAnchors')!.enabled = false;
                resolve({ root, modelId, status });
            } catch (error) {
                reject(error);
            }
        });
        app.assets.add(asset);
        app.assets.load(asset);
    });
