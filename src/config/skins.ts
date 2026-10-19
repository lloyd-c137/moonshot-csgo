// Disc skins: the shop catalogue, prices and each skin's look and effects. Shared by the room (prices and ownership
// are checked there) and the client (shop, discs, effects). Art: the owner-supplied PF renders (2026-10-19), each in
// a plain and a 计数器 (kill-counter) edition; public/assets/skins holds the top-down disc textures unwrapped from them
// and the shop cards. Players without a skin throw the default disc in their own colour.

export type SkinTier = 'standard' | 'deluxe' | 'rare' | 'epic' | 'legendary';

/** How the disc's flight trail looks (sampled every ~60 ms of flight). */
export type TrailStyle = 'glow' | 'spark' | 'pearl' | 'smoke' | 'thread' | 'chrome' | 'frost' | 'neon' | 'ember' | 'glitter';
/** What an elimination with the skin looks like (on top of the usual hit burst). */
export type KillStyle = 'ring' | 'sparks' | 'spiral' | 'shards' | 'lines' | 'chrome' | 'shatter' | 'glitch' | 'eruption' | 'coins';

type Rgb = readonly [number, number, number];

export type Skin = {
    id: string;
    name: string;
    tier: SkinTier;
    /** Points for the plain edition. */
    price: number;
    /** Extra points for the 计数器 edition (or to upgrade an owned plain one). */
    counterPrice: number;
    blurb: string;
    /** Trail and kill colours: main, accent. */
    colours: readonly [Rgb, Rgb];
    trail: TrailStyle;
    kill: KillStyle;
    /** Where the counter's digit plate sits on the disc texture (0–1 UV), its size and the digits' angle (deg). */
    counter: { x: number; y: number; length: number; thickness: number; angle: number; glow: Rgb };
};

/** Points: one per elimination, ten per round won (registered players only). */
export const SKIN_POINTS = { kill: 1, win: 10 } as const;

export const TIER_INFO: Record<SkinTier, { name: string; colour: string }> = {
    standard: { name: '普通', colour: '#9fb3c8' },
    deluxe: { name: '精良', colour: '#3fd0ff' },
    rare: { name: '稀有', colour: '#8a7dff' },
    epic: { name: '史诗', colour: '#ff4fd8' },
    legendary: { name: '传说', colour: '#ffc21a' }
};

const counterPrice = (price: number) => Math.round((price * 0.5) / 5) * 5;

const skin = (entry: Omit<Skin, 'counterPrice'>): Skin => ({ ...entry, counterPrice: counterPrice(entry.price) });

export const SKINS: readonly Skin[] = [
    skin({
        id: 'classic',
        name: '经典白',
        tier: 'standard',
        price: 99,
        blurb: '比赛级白色盘面，细银线勾边。',
        colours: [
            [0.95, 0.97, 1],
            [0.7, 0.85, 1]
        ],
        trail: 'glow',
        kill: 'ring',
        counter: { x: 0.565, y: 0.537, length: 0.17, thickness: 0.07, angle: 90, glow: [0.65, 0.9, 1] }
    }),
    skin({
        id: 'steel',
        name: '拉丝钢',
        tier: 'standard',
        price: 111,
        blurb: '整块拉丝钢面，飞行时迸出金属火花。',
        colours: [
            [0.78, 0.82, 0.88],
            [1, 0.75, 0.4]
        ],
        trail: 'spark',
        kill: 'sparks',
        counter: { x: 0.534, y: 0.555, length: 0.19, thickness: 0.08, angle: 75, glow: [0.65, 0.9, 1] }
    }),
    skin({
        id: 'pearl',
        name: '珍珠白',
        tier: 'deluxe',
        price: 222,
        blurb: '珠光漩纹，拖出柔和的珍珠光点，淘汰时绽开光之漩涡。',
        colours: [
            [1, 0.96, 0.98],
            [0.75, 0.85, 1]
        ],
        trail: 'pearl',
        kill: 'spiral',
        counter: { x: 0.564, y: 0.34, length: 0.12, thickness: 0.07, angle: 80, glow: [0.65, 0.9, 1] }
    }),
    skin({
        id: 'carbon',
        name: '碳纤维',
        tier: 'deluxe',
        price: 333,
        blurb: '编织碳纤维，掠过时留下暗色气流，命中碎成六角碳片。',
        colours: [
            [0.22, 0.24, 0.28],
            [0.55, 0.62, 0.72]
        ],
        trail: 'smoke',
        kill: 'shards',
        counter: { x: 0.668, y: 0.348, length: 0.1, thickness: 0.06, angle: 75, glow: [0.65, 0.9, 1] }
    }),
    skin({
        id: 'goldline',
        name: '黑金线',
        tier: 'rare',
        price: 444,
        blurb: '哑光黑盘描一道金线，飞行拉出细金丝，淘汰时金线环环扩散。',
        colours: [
            [0.95, 0.72, 0.32],
            [1, 0.9, 0.6]
        ],
        trail: 'thread',
        kill: 'lines',
        counter: { x: 0.489, y: 0.249, length: 0.16, thickness: 0.07, angle: 10, glow: [1, 0.7, 0.3] }
    }),
    skin({
        id: 'chrome',
        name: '黑铬环',
        tier: 'rare',
        price: 555,
        blurb: '黑盘嵌镜面铬环，沿途留下银色光圈，淘汰时铬环层层叠起。',
        colours: [
            [0.85, 0.88, 0.95],
            [0.45, 0.6, 0.85]
        ],
        trail: 'chrome',
        kill: 'chrome',
        counter: { x: 0.708, y: 0.63, length: 0.11, thickness: 0.07, angle: 80, glow: [0.65, 0.9, 1] }
    }),
    skin({
        id: 'glacier',
        name: '冰川',
        tier: 'epic',
        price: 666,
        blurb: '冰川彩绘盘面，飘落霜晶，淘汰时冰爆碎裂。',
        colours: [
            [0.55, 0.85, 1],
            [1, 1, 1]
        ],
        trail: 'frost',
        kill: 'shatter',
        counter: { x: 0.19, y: 0.53, length: 0.24, thickness: 0.08, angle: 90, glow: [0.6, 0.85, 1] }
    }),
    skin({
        id: 'neon',
        name: '霓虹',
        tier: 'epic',
        price: 777,
        blurb: '品红与青色灯带，拖出双色霓虹，淘汰时故障闪烁。',
        colours: [
            [1, 0.25, 0.85],
            [0.2, 0.9, 1]
        ],
        trail: 'neon',
        kill: 'glitch',
        counter: { x: 0.648, y: 0.423, length: 0.1, thickness: 0.06, angle: 80, glow: [0.4, 0.9, 1] }
    }),
    skin({
        id: 'magma',
        name: '熔岩',
        tier: 'legendary',
        price: 888,
        blurb: '黑岩裂出熔岩，飞行洒落余烬，淘汰时岩浆喷发。',
        colours: [
            [1, 0.35, 0.08],
            [1, 0.8, 0.25]
        ],
        trail: 'ember',
        kill: 'eruption',
        counter: { x: 0.593, y: 0.336, length: 0.15, thickness: 0.08, angle: -55, glow: [1, 0.45, 0.15] }
    }),
    skin({
        id: 'gilded',
        name: '鎏金',
        tier: 'legendary',
        price: 999,
        blurb: '整盘拉丝鎏金，一路金粉，淘汰时金币四溅。（金飞盘仍带光柱，不会混淆。）',
        colours: [
            [1, 0.8, 0.3],
            [1, 0.95, 0.7]
        ],
        trail: 'glitter',
        kill: 'coins',
        counter: { x: 0.623, y: 0.288, length: 0.15, thickness: 0.08, angle: -25, glow: [0.65, 0.9, 1] }
    })
];

export const skinById = (id: string | null | undefined) => (id ? SKINS.find((each) => each.id === id) ?? null : null);

/** Texture of the disc face (the 计数器 edition shows the counter plate). */
export const skinTextureUrl = (id: string, counter: boolean) => `/assets/skins/${id}${counter ? '-counter' : ''}.webp`;
/** The shop card (product render). */
export const skinCardUrl = (id: string, counter: boolean) => `/assets/skins/${id}${counter ? '-counter' : ''}-card.webp`;

/** One owned skin: whether it has the counter and the eliminations it has counted. */
export type OwnedSkin = { counter: boolean; kills: number };
export type SkinWallet = { points: number; owned: Record<string, OwnedSkin>; equipped: string | null };

/** The price of a purchase: the plain edition, the counter edition, or the counter upgrade of an owned plain one. */
export const purchasePrice = (skin: Skin, owned: OwnedSkin | undefined, counter: boolean) => {
    if (!owned) return skin.price + (counter ? skin.counterPrice : 0);
    if (counter && !owned.counter) return skin.counterPrice;
    return null; // already owned in that edition
};
