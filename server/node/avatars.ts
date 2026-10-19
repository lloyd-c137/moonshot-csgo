import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AvatarStore } from '../api.ts';

const AVATAR_KEY = /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export class FileAvatarStore implements AvatarStore {
    private readonly dataDirectory: string;

    constructor(dataDirectory: string) {
        this.dataDirectory = dataDirectory;
    }

    private path(key: string) {
        if (!AVATAR_KEY.test(key)) throw new Error('Invalid avatar key');
        return join(this.dataDirectory, ...key.split('/'));
    }

    async get(key: string) {
        if (!AVATAR_KEY.test(key)) return null;
        try {
            return new Uint8Array(await readFile(this.path(key)));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
    }

    async put(key: string, bytes: Uint8Array) {
        const filename = this.path(key);
        await mkdir(dirname(filename), { recursive: true });
        await writeFile(filename, bytes);
    }

    async delete(key: string) {
        await rm(this.path(key), { force: true });
    }
}
