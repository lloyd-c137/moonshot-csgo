type Sample = { at: number; value: number };

/** Opt-in local network panel: `?netdiag=1`. It contains no account or token data. */
export const createNetworkDiagnostics = () => {
    const enabled = new URLSearchParams(location.search).get('netdiag') === '1';
    if (!enabled) {
        const noop = () => undefined;
        return {
            state: noop,
            rtt: noop,
            snapshot: noop,
            snapshotText: noop,
            resync: noop
        };
    }

    const samples: Record<string, Sample[]> = { rtt: [], arrival: [], bytes: [], frame: [], longTask: [] };
    const encoder = new TextEncoder();
    let status = 'offline';
    let buffered = 0;
    let lastSnapshotAt = 0;
    let lastSeq: number | undefined;
    let sequenceGaps = 0;
    let resyncCount = 0;
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', '网络诊断');
    Object.assign(panel.style, {
        position: 'fixed', right: '12px', bottom: '12px', zIndex: '10000', width: '260px', padding: '12px',
        color: '#d9faff', background: 'rgba(4, 18, 38, .94)', border: '1px solid #13c9ff',
        boxShadow: '0 0 18px rgba(0, 168, 255, .28)', font: '12px/1.55 ui-monospace, monospace', pointerEvents: 'none'
    });
    document.body.append(panel);
    const add = (key: string, value: number, at = performance.now()) => {
        const list = samples[key];
        list.push({ at, value });
        if (list.length > 1024) list.shift();
    };
    const values = (key: string, withinMs = 60_000) => samples[key].filter((entry) => performance.now() - entry.at <= withinMs).map((entry) => entry.value);
    const percentile = (list: number[], p: number) => {
        if (!list.length) return '—';
        const sorted = [...list].sort((a, b) => a - b);
        return `${Math.round(sorted[Math.ceil(sorted.length * p) - 1])}`;
    };
    let previousFrame = performance.now();
    let previousFrameSample = previousFrame;
    const frame = (now: number) => {
        if (now - previousFrameSample >= 100) {
            add('frame', now - previousFrame, now);
            previousFrameSample = now;
        }
        previousFrame = now;
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if ('PerformanceObserver' in window) {
        try {
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) add('longTask', entry.duration);
            }).observe({ type: 'longtask', buffered: true });
        } catch {
            // Long Task API is not supported in every browser.
        }
    }
    window.setInterval(() => {
        const rtt = values('rtt');
        const recentBytes = values('bytes', 1000).reduce((sum, value) => sum + value, 0);
        const arrivals = values('arrival');
        const frameTimes = values('frame');
        panel.textContent = [
            `网络诊断 · ${status}`,
            `RTT P50/P95/P99: ${percentile(rtt, .5)}/${percentile(rtt, .95)}/${percentile(rtt, .99)} ms`,
            `快照间隔: ${percentile(arrivals, .5)} / ${percentile(arrivals, .95)} ms · 缺口 ${sequenceGaps} · 重同步 ${resyncCount}`,
            `快照吞吐: ${(recentBytes / 1024).toFixed(1)} KiB/s`,
            `帧时间 P95: ${percentile(frameTimes, .95)} ms · 长任务 ${values('longTask').length}`,
            `发送缓冲: ${Math.round(buffered / 1024)} KiB`,
            '服务端 Tick: 仅受控服务日志可见'
        ].join('\n');
        panel.style.whiteSpace = 'pre-line';
    }, 500);
    return {
        state: (next: string, amount = 0) => { status = next; buffered = amount; },
        rtt: (value: number) => add('rtt', value),
        snapshot: (bytes: number, seq?: number) => {
            const now = performance.now();
            if (lastSnapshotAt) add('arrival', now - lastSnapshotAt, now);
            lastSnapshotAt = now;
            add('bytes', bytes, now);
            if (seq !== undefined) {
                if (lastSeq !== undefined && seq > lastSeq + 1) sequenceGaps += seq - lastSeq - 1;
                lastSeq = seq;
            }
        },
        snapshotText: (text: string, seq?: number) => {
            const now = performance.now();
            if (lastSnapshotAt) add('arrival', now - lastSnapshotAt, now);
            lastSnapshotAt = now;
            add('bytes', encoder.encode(text).byteLength, now);
            if (seq !== undefined) {
                if (lastSeq !== undefined && seq > lastSeq + 1) sequenceGaps += seq - lastSeq - 1;
                lastSeq = seq;
            }
        },
        resync: () => { resyncCount++; }
    };
};
