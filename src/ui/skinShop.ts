// The 皮肤商店 panel on the title screen: points balance, every skin with its tier, price, throw and kill effects,
// and buy / 计数器 upgrade / equip buttons. Prices and ownership are checked again by the room.
import { purchasePrice, SKIN_POINTS, SKINS, skinCardUrl, TIER_INFO } from '../config/skins';
import type { KillStyle, TrailStyle } from '../config/skins';
import type { AccountStats } from '../net/protocol';

const TRAIL_LABEL: Record<TrailStyle, string> = {
    glow: '柔光尾迹',
    spark: '金属火花',
    pearl: '珍珠光点',
    smoke: '暗色气流',
    thread: '细金丝',
    chrome: '银色光圈',
    frost: '飘落霜晶',
    neon: '双色霓虹',
    ember: '飞溅余烬',
    glitter: '金粉'
};
const KILL_LABEL: Record<KillStyle, string> = {
    ring: '光环扩散',
    sparks: '火花迸射',
    spiral: '光之漩涡',
    shards: '碳片碎裂',
    lines: '金线环环扩散',
    chrome: '铬环叠起',
    shatter: '冰爆碎裂',
    glitch: '故障闪烁',
    eruption: '岩浆喷发',
    coins: '金币四溅'
};

export type ShopActions = {
    buy: (skin: string, counter: boolean) => Promise<AccountStats>;
    equip: (skin: string | null) => Promise<AccountStats>;
    /** Fresh account (points earned in play since the page loaded); null when signed out. */
    refresh: () => Promise<AccountStats | null>;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export const createSkinShop = (root: HTMLElement, actions: ShopActions, onAccount: (account: AccountStats) => void) => {
    let account: AccountStats | null = null;
    let available = false;
    let busy = false;
    const status = (message: string, tone: 'info' | 'error' = 'info') => {
        const line = root.querySelector<HTMLElement>('.shop-status');
        if (!line) return;
        line.textContent = message;
        line.dataset.tone = tone;
    };
    const act = async (label: string, run: () => Promise<AccountStats>) => {
        if (busy) return;
        busy = true;
        status(`${label}…`);
        try {
            const next = await run();
            account = next;
            onAccount(next);
            render();
            status(`${label}成功`);
        } catch (error) {
            status((error as Error).message, 'error');
        } finally {
            busy = false;
        }
    };

    const render = () => {
        const points = account?.points ?? 0;
        const owned = account?.skins ?? {};
        const equipped = account?.equippedSkin ?? null;
        const head = el('div', 'shop-head');
        const balance = el('div', 'shop-balance');
        balance.append(el('small', '', '我的积分'), el('b', '', account ? String(points) : '—'));
        const rules = el('p', 'shop-rules', `淘汰 1 人 +${SKIN_POINTS.kill} 积分 · 赢下一局 +${SKIN_POINTS.win} 积分 · 计数器版会记录这款皮肤的淘汰数`);
        head.append(balance, rules);
        const grid = el('div', 'shop-grid');

        // The default disc: free, in the player's own colour.
        const plain = el('article', 'shop-card shop-card-default');
        plain.dataset.equipped = String(equipped === null);
        const plainArt = el('div', 'shop-art shop-art-default');
        plainArt.append(el('i'));
        const plainBody = el('div', 'shop-body');
        plainBody.append(el('span', 'shop-tier', '默认'), el('h3', '', '队色飞盘'), el('p', 'shop-blurb', '你的玩家颜色，免费。'));
        const plainActions = el('div', 'shop-actions');
        const plainButton = el('button', 'shop-button', equipped === null ? '已装备' : '装备') as HTMLButtonElement;
        plainButton.type = 'button';
        plainButton.disabled = !account || equipped === null;
        plainButton.addEventListener('click', () => void act('装备', () => actions.equip(null)));
        plainActions.append(plainButton);
        plainBody.append(plainActions);
        plain.append(plainArt, plainBody);
        grid.append(plain);

        for (const skin of SKINS) {
            const mine = owned[skin.id];
            const tier = TIER_INFO[skin.tier];
            const card = el('article', 'shop-card');
            card.style.setProperty('--tier', tier.colour);
            card.dataset.owned = String(!!mine);
            card.dataset.equipped = String(equipped === skin.id);
            const art = el('div', 'shop-art');
            const image = el('img') as HTMLImageElement;
            image.loading = 'lazy';
            image.alt = skin.name;
            image.src = skinCardUrl(skin.id, mine?.counter === true);
            art.append(image);
            if (mine?.counter) art.append(el('span', 'shop-counter-badge', `计数器 · ${String(mine.kills).padStart(3, '0')}`));
            const body = el('div', 'shop-body');
            body.append(el('span', 'shop-tier', tier.name), el('h3', '', skin.name), el('p', 'shop-blurb', skin.blurb));
            const fx = el('dl', 'shop-fx');
            for (const [term, value] of [
                ['投掷', TRAIL_LABEL[skin.trail]],
                ['击杀', KILL_LABEL[skin.kill]]
            ]) {
                const row = el('div');
                row.append(el('dt', '', term), el('dd', '', value));
                fx.append(row);
            }
            body.append(fx);
            const buttons = el('div', 'shop-actions');
            const button = (label: string, enabled: boolean, onClick: () => void, primary = false) => {
                const b = el('button', `shop-button${primary ? ' primary' : ''}`, label) as HTMLButtonElement;
                b.type = 'button';
                b.disabled = !enabled;
                b.addEventListener('click', onClick);
                buttons.append(b);
            };
            if (!account) {
                button(available ? '登录后购买' : '联机后可购买', false, () => undefined);
                button(`${skin.price} 积分`, false, () => undefined);
            } else if (!mine) {
                const price = purchasePrice(skin, undefined, false)!;
                const counterPrice = purchasePrice(skin, undefined, true)!;
                button(points >= price ? `购买 · ${price}` : `${price} 积分 · 差 ${price - points}`, points >= price, () => void act('购买', () => actions.buy(skin.id, false)), true);
                button(`计数器版 · ${counterPrice}`, points >= counterPrice, () => void act('购买计数器版', () => actions.buy(skin.id, true)));
            } else {
                button(equipped === skin.id ? '已装备' : '装备', equipped !== skin.id, () => void act('装备', () => actions.equip(skin.id)), true);
                if (!mine.counter) {
                    const upgrade = purchasePrice(skin, mine, true)!;
                    button(`升级计数器 · ${upgrade}`, points >= upgrade, () => void act('升级计数器', () => actions.buy(skin.id, true)));
                }
            }
            body.append(buttons);
            card.append(art, body);
            grid.append(card);
        }
        const line = el('p', 'shop-status');
        line.setAttribute('role', 'status');
        root.replaceChildren(head, grid, line);
        if (!account) status(available ? '登录后即可用积分购买皮肤。' : '离线练习模式不能购买皮肤。');
    };

    return {
        /** The signed-in account (null when signed out) and whether accounts exist at all (online build). */
        set(next: AccountStats | null, accountsAvailable = available) {
            account = next;
            available = accountsAvailable;
            render();
        },
        /** Opening the shop: fetch the latest points and skins. */
        async open() {
            if (!account) return;
            try {
                const next = await actions.refresh();
                if (next) onAccount(next);
            } catch {
                /* keep what is shown */
            }
        },
        render
    };
};
