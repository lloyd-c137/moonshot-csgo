// Registry of GAMEPLAY_AUTHORED room interiors modelled from reference photos. The offline derivation leaves these
// rooms empty (no linework/layout furniture or generic lights) and the runtime builds the authored scene instead.
import { m104Scene } from './m104.ts';

export const AUTHORED_ROOM_IDS = ['M104'] as const;

export const authoredRoomScenes = () => [m104Scene()];
