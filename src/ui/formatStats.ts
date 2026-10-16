/** Loss-only index requested by the owner: wins/draws do not move it; each loss applies a 5% multiplicative penalty. */
export const formatWinRate = ({ losses }: { losses?: number }): string =>
    typeof losses === 'number' && Number.isFinite(losses) && Number.isInteger(losses) && losses >= 0
        ? `${(100 * 0.95 ** losses).toFixed(1)}%`
        : '—';
