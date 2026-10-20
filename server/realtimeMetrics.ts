/** Fixed-size, low-allocation metric windows shared by Worker and Node adapters. */
const WINDOW_MS = 60_000;
const CAPACITY = 4096;
const COUNTER_BUCKETS = 60;

export class RealtimeMetrics {
    private readonly samples = new Map<string, { times: Float64Array; values: Float64Array; next: number; count: number }>();
    private readonly counters = new Map<string, number>();
    private readonly counterWindows = new Map<string, { seconds: Float64Array; values: Float64Array }>();

    observe(name: string, value: number, now = Date.now()) {
        let series = this.samples.get(name);
        if (!series) {
            series = { times: new Float64Array(CAPACITY), values: new Float64Array(CAPACITY), next: 0, count: 0 };
            this.samples.set(name, series);
        }
        series.times[series.next] = now;
        series.values[series.next] = value;
        series.next = (series.next + 1) % CAPACITY;
        series.count = Math.min(series.count + 1, CAPACITY);
    }

    increment(name: string, amount = 1, now = Date.now()) {
        this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
        let buckets = this.counterWindows.get(name);
        if (!buckets) {
            buckets = { seconds: new Float64Array(COUNTER_BUCKETS).fill(-1), values: new Float64Array(COUNTER_BUCKETS) };
            this.counterWindows.set(name, buckets);
        }
        const second = Math.floor(now / 1000);
        const index = second % COUNTER_BUCKETS;
        if (buckets.seconds[index] !== second) {
            buckets.seconds[index] = second;
            buckets.values[index] = 0;
        }
        buckets.values[index] += amount;
    }

    /** Called only when exporting diagnostics, never from the game tick. */
    snapshot(now = Date.now()) {
        const metrics: Record<string, { count: number; p50: number; p95: number; p99: number; max: number }> = {};
        const ratesPerSecond: Record<string, number> = {};
        for (const [name, series] of this.samples) {
            const values: number[] = [];
            for (let i = 0; i < series.count; i++) {
                const index = (series.next - 1 - i + CAPACITY) % CAPACITY;
                if (now - series.times[index] > WINDOW_MS) break;
                values.push(series.values[index]);
            }
            if (!values.length) continue;
            values.sort((a, b) => a - b);
            const at = (p: number) => values[Math.max(0, Math.ceil(values.length * p) - 1)];
            metrics[name] = { count: values.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: values.at(-1)! };
        }
        const nowSecond = Math.floor(now / 1000);
        for (const [name, buckets] of this.counterWindows) {
            let total = 0;
            let oldest = nowSecond;
            for (let i = 0; i < COUNTER_BUCKETS; i++) {
                const second = buckets.seconds[i];
                if (second < 0 || second < nowSecond - COUNTER_BUCKETS + 1 || second > nowSecond) continue;
                total += buckets.values[i];
                oldest = Math.min(oldest, second);
            }
            ratesPerSecond[name] = total / Math.max(1, Math.min(COUNTER_BUCKETS, nowSecond - oldest + 1));
        }
        return { windowMs: WINDOW_MS, metrics, counters: Object.fromEntries(this.counters), ratesPerSecond };
    }
}
