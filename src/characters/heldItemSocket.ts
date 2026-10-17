import { Entity } from 'playcanvas';
import type { Entity as EntityType } from 'playcanvas';

/** Shared palm/rim grip anchor in the rig's hand_r space (metres). */
export const RIGHT_HAND_SOCKET_POSITION = [0, 0.115, 0.025] as const;

export const attachHeldItemSocket = (characterRoot: EntityType, name: string) => {
    const hand = characterRoot.findByName('hand_r') as EntityType | null;
    const socket = new Entity(name);
    (hand ?? characterRoot).addChild(socket);
    socket.setLocalPosition(...RIGHT_HAND_SOCKET_POSITION);
    return socket;
};
