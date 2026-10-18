/**
 * Personal medals, worked out from a stream of eliminations.
 * Pure: the match feeds kills in, the UI shows whatever comes back.
 */
export type MedalTier = 'normal' | 'rare' | 'legend';
export type MedalAward = { id: string; name: string; badge: string; tier: MedalTier; detail?: string };

export type KillFact = {
    /** Seconds on any monotonic clock. */
    time: number;
    killer: string;
    victim: string;
    head?: boolean;
    bank?: boolean;
    golden?: boolean;
    execution?: boolean;
    /** Throw distance in metres, when known. */
    distance?: number;
    /** The killer's weapon was the FRC disc launcher. */
    frc?: boolean;
    /** Players still alive after this kill (counting the killer). */
    aliveAfter?: number;
};

const MULTI_WINDOW = 4;
const LONGSHOT = 28;
const MULTI: Record<number, Omit<MedalAward, 'id'>> = {
    2: { name: '双杀', badge: '×2', tier: 'normal' },
    3: { name: '三杀', badge: '×3', tier: 'rare' },
    4: { name: '四杀', badge: '×4', tier: 'legend' },
    5: { name: '五杀', badge: '×5', tier: 'legend' }
};

export const createMedalTracker = (me: () => string) => {
    let firstBloodTaken = false;
    let chain = { count: 0, last: -Infinity };
    let streak = 0;
    /** Who eliminated me last, until I pay them back. */
    let nemesis: string | null = null;
    /** Kill streaks of everyone, to spot "终结" (ending someone's streak). */
    const streaks = new Map<string, number>();
    let leader: string | null = null;

    const reset = () => {
        firstBloodTaken = false;
        chain = { count: 0, last: -Infinity };
        streak = 0;
        nemesis = null;
        streaks.clear();
        leader = null;
    };

    /** Tell the tracker who is on top of the leaderboard (for 弑君). */
    const setLeader = (id: string | null) => {
        leader = id;
    };

    const kill = (fact: KillFact): MedalAward[] => {
        const self = me();
        const victimStreak = streaks.get(fact.victim) ?? 0;
        streaks.set(fact.victim, 0);
        streaks.set(fact.killer, (streaks.get(fact.killer) ?? 0) + 1);
        const wasFirst = !firstBloodTaken;
        firstBloodTaken = true;

        if (fact.victim === self) {
            streak = 0;
            chain = { count: 0, last: -Infinity };
            if (fact.killer !== self) nemesis = fact.killer;
            return [];
        }
        if (fact.killer !== self) return [];

        const out: MedalAward[] = [];
        const add = (id: string, name: string, badge: string, tier: MedalTier, detail?: string) =>
            out.push({ id, name, badge, tier, ...(detail ? { detail } : {}) });

        chain =
            fact.time - chain.last <= MULTI_WINDOW
                ? { count: chain.count + 1, last: fact.time }
                : { count: 1, last: fact.time };
        streak += 1;

        if (fact.execution) add('execution', '处决', '◆', 'legend');
        if (fact.golden) add('golden', '金盘击杀', '★', 'legend');
        const multi = MULTI[Math.min(chain.count, 5)];
        if (chain.count >= 2 && multi) add(`multi-${Math.min(chain.count, 5)}`, multi.name, multi.badge, multi.tier);
        if (wasFirst) add('first-blood', '首杀', '1', 'rare');
        if (nemesis && fact.victim === nemesis) {
            add('revenge', '复仇', '↺', 'normal');
            nemesis = null;
        }
        if (leader && fact.victim === leader && leader !== self) add('kingslayer', '弑君', '♛', 'rare', '击败榜首');
        if (victimStreak >= 3) add('buzzkill', '终结', '✕', 'rare', `终结 ${victimStreak} 连杀`);
        if (fact.head) add('head', '爆头', '◎', 'normal');
        if (fact.bank) add('bank', '反弹击杀', '⤴', 'rare');
        if ((fact.distance ?? 0) >= LONGSHOT)
            add('longshot', '远射', '↗', 'normal', `${Math.round(fact.distance!)} 米`);
        if (fact.frc) add('frc', 'FRC 击杀', '⚙', 'normal');
        if (fact.aliveAfter === 1) add('last-stand', '最后的幸存者', '◉', 'legend');
        if (streak === 5) add('streak-5', '五连胜势', '5', 'rare', '连续 5 次击杀未倒下');
        if (streak === 10) add('streak-10', '无人可挡', '10', 'legend', '连续 10 次击杀未倒下');

        // Show the most exciting first; never flood (the UI keeps three waiting).
        const rank: Record<MedalTier, number> = { legend: 0, rare: 1, normal: 2 };
        return out.sort((a, b) => rank[a.tier] - rank[b.tier]).slice(0, 3);
    };

    return { kill, reset, setLeader };
};
