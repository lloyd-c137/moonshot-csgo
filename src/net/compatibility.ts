import type { NetState } from './client.ts';

/** Keep online posture changes disabled unless the connected server explicitly advertises crouch-v1. */
export const canUseCrouch = (state: NetState, serverCrouchV1: boolean) =>
    state === 'offline' || state === 'rejected' || (state === 'online' && serverCrouchV1);
