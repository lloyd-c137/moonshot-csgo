// Door-sign lettering for a room (pure; shared by the runtime signs and tests).
import type { CampusRoom } from './roomIndex';

export type SignText = { code: string; chinese: string[]; english: string[] };

/** Room code and names split into sign lines (Chinese up to 3 characters on one line, longer names split evenly, English upper case ≤ 14). */
export const signText = (room: CampusRoom): SignText => {
    const chineseName = /^房间\s/.test(room.name) ? '' : room.name.replace(/[（(].*[)）]/, '');
    const chinese: string[] = [];
    const chars = [...chineseName];
    const perLine = chars.length <= 3 ? chars.length : Math.min(4, Math.ceil(chars.length / 2));
    for (let i = 0; i < chars.length; i += Math.max(1, perLine)) chinese.push(chars.slice(i, i + perLine).join(''));
    const english: string[] = [];
    const englishName = (room.nameEnglish ?? '')
        .replace(new RegExp(`\\s*${room.id}$`), '')
        .trim()
        .toUpperCase();
    for (const word of englishName.split(/\s+/).filter(Boolean)) {
        const last = english[english.length - 1];
        if (last && (last + ' ' + word).length <= 14) english[english.length - 1] = `${last} ${word}`;
        else english.push(word);
    }
    return { code: room.id, chinese: chinese.slice(0, 3), english: english.slice(0, 3) };
};
