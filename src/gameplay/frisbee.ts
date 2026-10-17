// Flying-disc model and hit geometry (pure; tested in test/frisbee.test.js).
//
// Aerodynamics follow the usual two-coefficient flying-disc model (Hummel 2003, after Potts & Crowther): lift and
// drag from the angle of attack between the velocity and the disc plane. The game world runs player gravity at
// 18 m/s², so discs get an upward compensation to fly under real gravity (9.81 m/s²).

export type V3 = [number, number, number];

export const DISC = {
    mass: 0.175,
    radius: 0.135,
    thickness: 0.03,
    area: Math.PI * 0.135 * 0.135,
    airDensity: 1.23,
    cl0: 0.15,
    clAlpha: 1.4,
    cd0: 0.08,
    cdAlpha: 2.72,
    alpha0: (-4 * Math.PI) / 180,
    gravity: 9.81
} as const;

/** Throw tuning: launch speed grows with how long the button was held. */
export const THROW = {
    /** A quick tap is already a usable flick; holding builds to a long, fast throw. */
    minSpeed: 14,
    maxSpeed: 24,
    chargeSeconds: 0.55,
    /** Disc plane pitched this much above the launch direction (positive angle of attack). */
    noseUp: (4 * Math.PI) / 180,
    maxElevation: (40 * Math.PI) / 180,
    minElevation: (-30 * Math.PI) / 180
} as const;

/** A thrown disc may hit players until it settles on the floor or this many seconds pass. */
export const DISC_LIVE_SECONDS = 3.5;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalise = (a: V3): V3 => {
    const l = length(a);
    return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
};

export const chargeSpeed = (heldSeconds: number) =>
    THROW.minSpeed + (THROW.maxSpeed - THROW.minSpeed) * Math.min(1, Math.max(0, heldSeconds / THROW.chargeSeconds));

/**
 * Disc normal for a launch direction and a roll tilt (radians, positive banks to the thrower's right):
 * the disc plane is pitched `noseUp` above the launch direction, then rolled about the launch heading.
 */
export const launchNormal = (direction: V3, tilt = 0): V3 => {
    const d = normalise(direction);
    const elevation = Math.asin(Math.max(-1, Math.min(1, d[1])));
    const heading: V3 = normalise([d[0], 0, d[2]]);
    const pitch = elevation + THROW.noseUp;
    // Normal of a plane pitched by `pitch` along the heading: up rotated backwards about the right axis.
    const up: V3 = add(scale([0, 1, 0], Math.cos(pitch)), scale(heading, -Math.sin(pitch)));
    const right: V3 = [-heading[2], 0, heading[0]];
    return normalise(add(scale(up, Math.cos(tilt)), scale(right, Math.sin(tilt))));
};

/** Aerodynamic acceleration (m/s²) for velocity `v` and disc normal `n`, plus the gravity compensation. */
export const discAcceleration = (v: V3, n: V3, worldGravity: number): V3 => {
    const speed = length(v);
    const compensation: V3 = [0, Math.abs(worldGravity) - DISC.gravity, 0];
    if (speed < 0.5) return compensation;
    const vHat = scale(v, 1 / speed);
    const along = dot(vHat, n);
    const alpha = Math.max(-0.6, Math.min(0.8, -Math.asin(Math.max(-1, Math.min(1, along)))));
    const pressure = 0.5 * DISC.airDensity * speed * speed * DISC.area;
    const lift = pressure * (DISC.cl0 + DISC.clAlpha * alpha);
    const drag = pressure * (DISC.cd0 + DISC.cdAlpha * (alpha - DISC.alpha0) ** 2);
    const liftDir = normalise(sub(n, scale(vHat, along)));
    const force = add(scale(liftDir, lift), scale(vHat, -drag));
    return add(scale(force, 1 / DISC.mass), compensation);
};

/** Flight without obstacles (for tests and tuning): positions every `dt` until the disc reaches the floor. */
export const simulateFlight = (origin: V3, velocity: V3, normal: V3, dt = 1 / 120, maxSeconds = 8) => {
    const points: V3[] = [origin];
    let p = origin;
    let v = velocity;
    for (let t = 0; t < maxSeconds && p[1] > 0; t += dt) {
        const a = add(discAcceleration(v, normal, DISC.gravity), [0, -DISC.gravity, 0]);
        v = add(v, scale(a, dt));
        p = add(p, scale(v, dt));
        points.push(p);
    }
    return points;
};

/** Closest point on segment a-b to point p, clamped to the segment endpoints. */
export const closestPointOnSegment = (a: V3, b: V3, p: V3): V3 => {
    const delta = sub(b, a);
    const lengthSquared = dot(delta, delta);
    const fraction = lengthSquared > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), delta) / lengthSquared)) : 0;
    return add(a, scale(delta, fraction));
};

/** Squared distance between segments p0-p1 and q0-q1. */
export const segmentDistance = (p0: V3, p1: V3, q0: V3, q1: V3) => {
    const d1 = sub(p1, p0);
    const d2 = sub(q1, q0);
    const r = sub(p0, q0);
    const a = dot(d1, d1);
    const e = dot(d2, d2);
    const f = dot(d2, r);
    let s = 0;
    let t = 0;
    if (a <= 1e-12 && e <= 1e-12) return length(r);
    if (a <= 1e-12) {
        t = Math.min(1, Math.max(0, f / e));
    } else {
        const c = dot(d1, r);
        if (e <= 1e-12) {
            s = Math.min(1, Math.max(0, -c / a));
        } else {
            const b = dot(d1, d2);
            const denom = a * e - b * b;
            s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
            t = (b * s + f) / e;
            if (t < 0) {
                t = 0;
                s = Math.min(1, Math.max(0, -c / a));
            } else if (t > 1) {
                t = 1;
                s = Math.min(1, Math.max(0, (b - c) / a));
            }
        }
    }
    return length(sub(add(p0, scale(d1, s)), add(q0, scale(d2, t))));
};

/** Player hit volume (slightly generous, favouring the thrower): capsule centre `c`, radius, core half-height. */
export const PLAYER_HIT = { radius: 0.36, halfCore: 0.64 } as const;

export type DiscContact = {
    /** First point on the swept disc-centre segment that touches the player's existing hit capsule. */
    at: V3;
    /** Normalized distance along the frame's disc segment, from 0 to 1. */
    fraction: number;
    /** Direction of disc travel during the frame. */
    impactDirection: V3;
    /** Candidate region only; the room still makes the authoritative headshot decision. */
    region: 'head' | 'body';
};

const capsuleDistanceSquared = (point: V3, centre: V3) => {
    const nearestY = Math.max(centre[1] - PLAYER_HIT.halfCore, Math.min(centre[1] + PLAYER_HIT.halfCore, point[1]));
    const dx = point[0] - centre[0];
    const dy = point[1] - nearestY;
    const dz = point[2] - centre[2];
    return dx * dx + dy * dy + dz * dz;
};

/** Earliest swept-segment contact with the existing capsule, including its disc-radius allowance. */
export const discContactWithPlayer = (a: V3, b: V3, centre: V3): DiscContact | null => {
    const delta = sub(b, a);
    const radius = PLAYER_HIT.radius + DISC.radius;
    const radiusSquared = radius * radius;
    const atFraction = (fraction: number): V3 => add(a, scale(delta, fraction));
    if (capsuleDistanceSquared(a, centre) <= radiusSquared) {
        const at = a;
        return {
            at,
            fraction: 0,
            impactDirection: normalise(delta),
            region: at[1] - centre[1] > 0.45 ? 'head' : 'body'
        };
    }

    // Distance from a point on a segment to a convex capsule is convex. Find its minimum,
    // then binary-search the first boundary crossing on the monotonic approach to that minimum.
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 36; iteration++) {
        const left = (2 * low + high) / 3;
        const right = (low + 2 * high) / 3;
        if (capsuleDistanceSquared(atFraction(left), centre) <= capsuleDistanceSquared(atFraction(right), centre)) {
            high = right;
        } else {
            low = left;
        }
    }
    const minimum = (low + high) / 2;
    if (capsuleDistanceSquared(atFraction(minimum), centre) > radiusSquared) return null;

    low = 0;
    high = minimum;
    for (let iteration = 0; iteration < 36; iteration++) {
        const middle = (low + high) / 2;
        if (capsuleDistanceSquared(atFraction(middle), centre) <= radiusSquared) high = middle;
        else low = middle;
    }
    const fraction = high;
    const at = atFraction(fraction);
    return {
        at,
        fraction,
        impactDirection: normalise(delta),
        region: at[1] - centre[1] > 0.45 ? 'head' : 'body'
    };
};

/** Earliest eligible player contact on a frame segment; ties are stable across Map insertion order. */
export const earliestDiscContact = (
    a: V3,
    b: V3,
    targets: Map<string, V3>,
    ignoreId?: string
): { target: string; contact: DiscContact } | null => {
    let earliest: { target: string; contact: DiscContact } | null = null;
    for (const [target, centre] of targets) {
        if (target === ignoreId) continue;
        const contact = discContactWithPlayer(a, b, centre);
        if (
            contact &&
            (!earliest ||
                contact.fraction < earliest.contact.fraction ||
                (contact.fraction === earliest.contact.fraction && target < earliest.target))
        )
            earliest = { target, contact };
    }
    return earliest;
};

/** Whether the disc moving from `a` to `b` touches a player capsule centred at `c`. */
export const discHitsPlayer = (a: V3, b: V3, c: V3) => discContactWithPlayer(a, b, c) !== null;
