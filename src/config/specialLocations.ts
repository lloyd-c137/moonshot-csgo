import { PE_OFFICE } from './office.ts';

/** Monitor is GAMEPLAY_AUTHORED on the S103 desk derived from the published room layout. */
export const MONITOR_CONSOLE = { id: 'S103', name: '监控室电脑', x: -41.875, y: 1.2, z: 11.169 } as const;
export const BREAKER_CABINET = [-51.95, 1.25, -13.08] as const;

/** Pins point to the matching interaction object or the existing S308 room centroid. */
export const SPECIAL_LOCATIONS = [
    { id: 'breaker', short: '配', name: '配电室', x: BREAKER_CABINET[0], z: BREAKER_CABINET[2], colour: '#ff765f' },
    { id: 'monitor', short: '监', name: '监控室', x: MONITOR_CONSOLE.x, z: MONITOR_CONSOLE.z, colour: '#65d8e8' },
    { id: 'pe-office', short: '体', name: '体育办公室', x: PE_OFFICE.x, z: PE_OFFICE.z, colour: '#b8d879' }
] as const;
