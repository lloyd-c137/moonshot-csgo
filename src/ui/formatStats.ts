/** Older servers / unrecorded history have no denominator: do not imply a measured 0% win rate. */
export const formatWinRate = ({ wins, rounds }: { wins?: number; rounds?: number }): string =>
    typeof wins === 'number' &&
    typeof rounds === 'number' &&
    Number.isFinite(wins) &&
    Number.isFinite(rounds) &&
    rounds > 0 &&
    wins >= 0 &&
    wins <= rounds
        ? `${((wins / rounds) * 100).toFixed(1)}%`
        : '—';
