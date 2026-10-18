import { Asset } from 'playcanvas';
import type { AppBase, ContainerResource, Entity } from 'playcanvas';

import type { ItemKind } from '../config/gameplayItems';

const MODEL_URL: Partial<Record<ItemKind, string>> = {
    revive: '/assets/pickups/revive-medkit.glb',
    eye: '/assets/pickups/eye-monitor.glb',
    creation: '/assets/pickups/creation-gear.glb'
};

/** Shared, immutable OpenGameArt GLB resources; each world pickup gets its own entity instance. */
export class PickupAssetLoader {
    private readonly resources: Map<ItemKind, ContainerResource>;

    private constructor(resources: Map<ItemKind, ContainerResource>) {
        this.resources = resources;
    }

    static load(app: AppBase) {
        const entries = Object.entries(MODEL_URL) as [ItemKind, string][];
        return Promise.all(entries.map(([kind, url]) => new Promise<[ItemKind, ContainerResource]>((resolve, reject) => {
            const asset = new Asset(`Pickup ${kind}`, 'container', { url });
            asset.once('error', (error: string) => reject(new Error(`Pickup GLB ${kind} failed: ${error}`)));
            asset.once('load', () => {
                const resource = asset.resource as ContainerResource | null;
                if (!resource?.instantiateRenderEntity) {
                    reject(new Error(`Pickup GLB ${kind} has no renderable container`));
                    return;
                }
                resolve([kind, resource]);
            });
            app.assets.add(asset);
            app.assets.load(asset);
        }))).then((models) => new PickupAssetLoader(new Map(models)));
    }

    instantiate(kind: ItemKind): Entity {
        const resource = this.resources.get(kind);
        if (!resource) throw new Error(`No imported pickup model registered for ${kind}`);
        return resource.instantiateRenderEntity({ castShadows: false });
    }
}
