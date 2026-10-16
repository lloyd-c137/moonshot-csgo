import typescriptConfig from '@playcanvas/eslint-config/typescript';

export default [
    { ignores: ['.claude', '.agents', 'public/ammo', '**/.wrangler', '.audio-lab-local/**'] },
    ...typescriptConfig
];
