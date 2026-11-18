// Animations du jeu : traduit les événements renvoyés par packages/core (step, teleport)
// en interpolations. Aucune règle ici, et aucune dépendance à Shallot : ce module
// ne manipule que des identifiants d'entités et des positions, il tourne aussi sous Node.

export type V3 = [number, number, number];
export type Ease = (p: number) => number;

export const EASE = {
    linear: (p: number) => p,
    out: (p: number) => 1 - (1 - p) ** 3,
    in: (p: number) => p * p,
    inOut: (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
    // léger dépassement puis retour : pour les apparitions
    back: (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};

// Une interpolation d'une propriété d'une entité entre t0 et t1 (en secondes).
// arc : bond vertical ; osc : oscillation autour de la valeur (secousse, pulsation).
export interface Tween {
    eid: number;
    t0: number;
    t1: number;
    prop: "translation" | "scale";
    from: V3;
    to: V3;
    ease: Ease;
    arc?: number;
    osc?: { amp: V3; n: number; decay: boolean };
}

export class Timeline {
    tweens: Tween[] = [];
    cues: { t: number; run: () => void }[] = [];
    time = 0;
    end = 0;
    private sorted = false;
    private nextCue = 0;

    add(tw: Tween): void {
        this.tweens.push(tw);
        this.end = Math.max(this.end, tw.t1);
        this.sorted = false;
    }
    cue(t: number, run: () => void): void {
        this.cues.push({ t, run });
        this.end = Math.max(this.end, t);
        this.sorted = false;
    }
    get done(): boolean {
        return this.time >= this.end;
    }

    // Applique les valeurs à l'instant courant. Les interpolations sont rejouées par ordre
    // de départ : pour une même entité, la plus récente l'emporte.
    sample(apply: (eid: number, prop: Tween["prop"], v: V3) => void): void {
        if (!this.sorted) {
            this.tweens.sort((a, b) => a.t0 - b.t0);
            this.cues.sort((a, b) => a.t - b.t);
            this.sorted = true;
        }
        const t = this.time;
        for (const tw of this.tweens) {
            if (tw.t0 > t) break;
            const p = tw.t1 > tw.t0 ? Math.min(1, (t - tw.t0) / (tw.t1 - tw.t0)) : 1;
            const e = tw.ease(p);
            const v: V3 = [0, 1, 2].map((i) => tw.from[i] + (tw.to[i] - tw.from[i]) * e) as V3;
            if (tw.arc) v[1] += tw.arc * Math.sin(Math.PI * p);
            if (tw.osc) {
                const k = Math.sin(p * Math.PI * tw.osc.n) * (tw.osc.decay ? 1 - p : 1);
                for (let i = 0; i < 3; i++) v[i] += tw.osc.amp[i] * k;
            }
            apply(tw.eid, tw.prop, v);
        }
        while (this.nextCue < this.cues.length && this.cues[this.nextCue].t <= t) this.cues[this.nextCue++].run();
    }
}

// Ce que le planificateur doit savoir de la scène
export interface PlanCtx {
    idAt: Map<string, number>; // case "r,c" → entité du bloc ; "player" → joueur. Mis à jour au fil des événements.
    pos: (eid: number) => V3; // position actuelle de l'entité
    cell: (key: string, y: number) => V3; // centre d'une case, à la hauteur y
    restY: (eid: number) => number; // hauteur de repos de l'entité
    scale: (eid: number) => V3; // échelle de repos
}

// Un bloc tombé dans un trou s'y enfonce jusqu'à affleurer le sol : il devient un pont.
export const SINK_Y = -0.4;
const STEP = 0.14;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const rollDur = (d: number) => clamp(0.05 + d * 0.075, 0.12, 0.6);
const pushDur = (d: number) => (d <= 1 ? STEP : rollDur(d));
const dist = (a: string, b: string) => {
    const [r1, c1] = a.split(",").map(Number), [r2, c2] = b.split(",").map(Number);
    return Math.abs(r1 - r2) + Math.abs(c1 - c2);
};
const ZERO: V3 = [0, 0, 0];

type Ev = { type: string; from?: string; to?: string; at?: string; kind?: string; turn?: boolean; mirror?: string; moves?: { from: string; to: string; player?: boolean; fill?: boolean }[] };

// Construit la chronologie d'un coup. Comme dans le lab, les événements s'enchaînent :
// le joueur et le bloc qu'il pousse partent ensemble, un rond qui roule fait attendre la suite.
// facing : direction du coup en [dx, dz], pour la secousse d'un bloc qui encaisse le choc (bump).
export function plan(events: Ev[], bump: string | undefined, facing: [number, number], ctx: PlanCtx): Timeline {
    const tl = new Timeline(), last = new Map<number, V3>(), busy = new Map<number, number>();
    const at = (eid: number) => last.get(eid) ?? ctx.pos(eid);
    const free = (...eids: number[]) => Math.max(cursor, ...eids.map((e) => busy.get(e) ?? 0));
    const slide = (eid: number, to: V3, t0: number, dur: number, ease: Ease, arc?: number) => {
        tl.add({ eid, t0, t1: t0 + dur, prop: "translation", from: at(eid), to, ease, arc });
        last.set(eid, to);
        busy.set(eid, t0 + dur);
    };
    const take = (key: string) => {
        const eid = ctx.idAt.get(key);
        if (eid === undefined) throw new Error(`Aucune entité en ${key}`);
        ctx.idAt.delete(key);
        return eid;
    };
    let cursor = 0;

    if (bump !== undefined && ctx.idAt.has(bump)) {
        const eid = ctx.idAt.get(bump)!, p = at(eid);
        tl.add({ eid, t0: 0, t1: 0.3, prop: "translation", from: p, to: p, ease: EASE.linear, osc: { amp: [facing[0] * 0.07, 0, facing[1] * 0.07], n: 4, decay: true } });
        busy.set(eid, 0.3);
    }

    for (const e of events) {
        switch (e.type) {
            case "player": {
                const eid = ctx.idAt.get("player")!;
                slide(eid, ctx.cell(e.to!, ctx.restY(eid)), free(eid), STEP, EASE.inOut, 0.1);
                break;
            }
            case "move":
            case "fill": {
                const eid = take(e.from!), round = e.kind === "R", d = dist(e.from!, e.to!);
                const dur = round ? rollDur(d) : pushDur(d), t0 = free(eid);
                slide(eid, ctx.cell(e.to!, ctx.restY(eid)), t0, dur, e.turn ? EASE.linear : round ? EASE.out : EASE.inOut);
                if (e.type === "move") ctx.idAt.set(e.to!, eid);
                else {
                    slide(eid, ctx.cell(e.to!, SINK_Y), t0 + dur, 0.18, EASE.in);
                    cursor = t0 + dur;
                }
                if (round) cursor = Math.max(cursor, t0 + dur * 0.85);
                break;
            }
            case "vanish": {
                const eid = take(e.at!);
                slide(eid, ctx.cell(e.at!, SINK_Y), free(eid), 0.2, EASE.in);
                break;
            }
            case "break": {
                const eid = take(e.at!), t0 = free(eid), s = ctx.scale(eid);
                tl.add({ eid, t0, t1: t0 + 0.08, prop: "scale", from: s, to: s.map((x) => x * 1.15) as V3, ease: EASE.out });
                tl.add({ eid, t0: t0 + 0.08, t1: t0 + 0.2, prop: "scale", from: s.map((x) => x * 1.15) as V3, to: ZERO, ease: EASE.in });
                busy.set(eid, t0 + 0.2);
                cursor = t0 + 0.12;
                break;
            }
            case "multi": {
                const items = e.moves!.map((m) => ({ ...m, eid: take(m.from) }));
                const dd = Math.max(...items.map((m) => dist(m.from, m.to)));
                const dur = pushDur(dd), t0 = free(...items.map((m) => m.eid));
                for (const m of items) {
                    slide(m.eid, ctx.cell(m.to, ctx.restY(m.eid)), t0, dur, dd > 1 ? EASE.out : EASE.inOut);
                    ctx.idAt.set(m.to, m.eid);
                }
                cursor = t0 + (dd > 1 ? dur * 0.9 : 0.09);
                break;
            }
            case "tp": {
                // tout ce qui traverse le miroir rétrécit, passe de l'autre côté, puis réapparaît
                const items = e.moves!.map((m) => ({ ...m, eid: m.player ? ctx.idAt.get("player")! : take(m.from) }));
                const t0 = free(...items.map((m) => m.eid)), h = 0.17;
                for (const m of items) {
                    const s = ctx.scale(m.eid), to = ctx.cell(m.to, m.fill ? SINK_Y : ctx.restY(m.eid));
                    tl.add({ eid: m.eid, t0, t1: t0 + h, prop: "scale", from: s, to: ZERO, ease: EASE.in });
                    tl.add({ eid: m.eid, t0: t0 + h, t1: t0 + h, prop: "translation", from: to, to, ease: EASE.linear });
                    tl.add({ eid: m.eid, t0: t0 + h, t1: t0 + 2 * h, prop: "scale", from: ZERO, to: s, ease: EASE.back });
                    last.set(m.eid, to);
                    busy.set(m.eid, t0 + 2 * h);
                    if (!m.player && !m.fill) ctx.idAt.set(m.to, m.eid);
                }
                const mirror = e.mirror !== undefined ? ctx.idAt.get(e.mirror) : undefined;
                if (mirror !== undefined) {
                    const s = ctx.scale(mirror);
                    tl.add({ eid: mirror, t0, t1: t0 + 2 * h, prop: "scale", from: s, to: s, ease: EASE.linear, osc: { amp: s.map((x) => x * 0.15) as V3, n: 1, decay: false } });
                }
                cursor = t0 + 2 * h;
                break;
            }
        }
    }
    return tl;
}
