export type RoundOutcome = 'golden-disc' | 'last-survivor' | 'draw';

export const roundResultCopy = (result: { outcome: RoundOutcome; winner: string | null; mine: boolean }) => ({
    kicker:
        result.outcome === 'golden-disc'
            ? '金飞盘守擂'
            : result.outcome === 'last-survivor'
              ? '最终幸存者'
              : '本局平局',
    title:
        result.outcome === 'draw' ? '没有胜者' : result.mine ? '你赢得了本局！' : `${result.winner ?? '对手'} 赢得本局`
});
