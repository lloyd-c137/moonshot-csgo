import typescriptConfig from '@playcanvas/eslint-config/typescript';

export default [
    { ignores: ['.claude', '.agents', 'public/ammo', '**/.wrangler', 'dist/**', 'dist-server/**', '.audio-lab-local/**'] },
    ...typescriptConfig
];
