/** Owner-requested initial 100%; after the first completed round use the actual win ratio. */
export const formatWinRate = ({ wins, rounds }: { wins?: number; rounds?: number }): string =>
    typeof wins === 'number' &&
    typeof rounds === 'number' &&
    Number.isFinite(wins) &&
    Number.isFinite(rounds) &&
    rounds >= 0 &&
    wins >= 0 &&
    wins <= rounds
        ? `${(rounds === 0 ? 100 : (wins / rounds) * 100).toFixed(1)}%`
        : '—';
