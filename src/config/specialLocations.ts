import { GEORGE_TERMINAL } from './george.ts';
import { PE_OFFICE } from './office.ts';

/** Monitor is GAMEPLAY_AUTHORED on the S103 desk derived from the published room layout. */
export const MONITOR_CONSOLE = { id: 'S103', name: '监控室电脑', x: -41.875, y: 1.2, z: 11.169 } as const;
export const BREAKER_CABINET = [-51.95, 1.25, -13.08] as const;
/** GAMEPLAY_AUTHORED: medical pickup pin at a walkable point in the M116 room polygon. */
export const MEDICAL_ROOM = { id: 'M116', name: '医务室', x: -64.68, z: -8.64 } as const;

/** Pins point to the matching interaction object or the existing S308 room centroid. */
export const SPECIAL_LOCATIONS = [
    { id: 'breaker', short: '配', name: '配电室', x: BREAKER_CABINET[0], z: BREAKER_CABINET[2], colour: '#ff765f' },
    { id: 'monitor', short: '监', name: '监控室', x: MONITOR_CONSOLE.x, z: MONITOR_CONSOLE.z, colour: '#65d8e8' },
    { id: 'pe-office', short: '体', name: '体育办公室', x: PE_OFFICE.x, z: PE_OFFICE.z, colour: '#b8d879' },
    { id: 'medical', short: '医', name: '医务室', x: MEDICAL_ROOM.x, z: MEDICAL_ROOM.z, colour: '#ff9f9a' },
    { id: 'george-server', short: 'G', name: 'George 服务器 · M103 创客空间', x: GEORGE_TERMINAL.x, z: GEORGE_TERMINAL.z, colour: '#ff5969' }
] as const;
