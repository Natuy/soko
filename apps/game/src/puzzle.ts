// Habillage Shallot du jeu. Aucune règle ici : chaque coup passe par packages/core.
// Les blocs et le joueur sont des entités persistantes, déplacées en suivant les événements
// renvoyés par le moteur (voir anim.ts). La scène n'est reconstruite qu'au chargement
// d'un niveau, après une annulation, ou si elle s'écarte de l'état (filet de sécurité).
import {
    Camera,
    CameraMode,
    DirectionalLight,
    eulerToQuat,
    GlobalAmbientLight,
    lookAtRotation,
    Materials,
    Meshes,
    type MeshHandle,
    MeshInstance,
    MeshMaterial,
    MeshPlugin,
    type Plugin,
    sphere,
    StandardMaterial,
    StandardRenderer,
    Transform,
    type World,
} from "@dylanebert/shallot";
import type { MaterialHandle } from "@dylanebert/shallot/standard/rendering";
import { applyMove, DIRS, isWin, LEVELS, parseLevel } from "../../../packages/core/src/index.js";
import { EASE, plan, Timeline, type V3 } from "./anim";
import { progress, ui } from "./menus";

type Move = "U" | "D" | "L" | "R" | "*";
type Action = Move | "undo" | "reset" | "next" | "prev";
type State = ReturnType<typeof parseLevel>;

const COLORS = {
    floor: [0.84, 0.79, 0.7, 1],
    filled: [0.66, 0.6, 0.52, 1],
    wall: [0.29, 0.25, 0.22, 1],
    exit: [0.91, 0.7, 0.23, 1],
    square: [0.78, 0.41, 0.25, 1],
    round: [0.25, 0.5, 0.66, 1],
    player: [0.18, 0.54, 0.36, 1],
    eye: [0.1, 0.12, 0.1, 1],
    breakable: [0.89, 0.76, 0.37, 1],
    half: [0.48, 0.37, 0.65, 1],
    sticky: [0.55, 0.78, 0.25, 1],
    mirror: [0.85, 0.9, 0.94, 1],
    fixed: [0.33, 0.35, 0.38, 1],
    teal: [0.23, 0.6, 0.56, 1],
    deflector: [0.37, 0.32, 0.27, 1],
    glass: [0.6, 0.8, 0.9, 1],
} as const;
type ColorName = keyof typeof COLORS;

const SPEED = { normale: 1, rapide: 1.8, aucune: Infinity } as const;
const DOOR = { open: { y: 0.03, s: [0.9, 0.06, 0.9] as V3 }, closed: { y: 0.45, s: [0.9, 0.9, 0.9] as V3 } };

// ---- État de la partie (hors ECS : c'est le modèle, la scène n'en est qu'une vue) ----
const game = {
    world: null as unknown as World,
    mats: null as unknown as Record<ColorName, MaterialHandle>,
    ball: null as unknown as MeshHandle,
    camera: 0,
    index: 0,
    state: null as unknown as State,
    holes0: new Set<string>(), // trous au départ : ceux qui ont disparu ont été comblés
    history: [] as State[],
    queue: [] as Action[],
    spawned: [] as number[],
    rest: new Map<number, { t: V3; s: V3 }>(), // position et échelle de repos de chaque entité
    idAt: new Map<string, number>(), // case → bloc, "player" → joueur
    doors: [] as number[],
    eye: -1,
    anim: null as Timeline | null,
    won: false,
};

const cellOf = (key: string, y: number): V3 => {
    const [r, c] = key.split(",").map(Number), s = game.state;
    return [c - (s.w - 1) / 2, y, r - (s.h - 1) / 2];
};

function startLevel(i: number): void {
    game.index = (i + LEVELS.length) % LEVELS.length;
    game.state = parseLevel(LEVELS[game.index].map);
    game.holes0 = new Set(game.state.holes);
    game.history = [];
    game.queue = [];
    game.won = false;
    progress.setLast(game.index);
    ui.resetHint();
    try { history.replaceState(null, "", `#niveau-${game.index + 1}`); } catch {}
    if (game.world) {
        game.world.storage(Camera).size.set(game.camera, viewSize(game.state));
        rebuild(true);
    }
}

function hud(): void {
    const l = LEVELS[game.index];
    (document.getElementById("world") as HTMLElement).textContent = l.world;
    (document.getElementById("name") as HTMLElement).textContent = `${game.index + 1}. ${l.name}`;
    (document.getElementById("moves") as HTMLElement).textContent = `${game.history.length} coup${game.history.length > 1 ? "s" : ""}`;
}

// ---- Entrées : clavier + glisser/toucher, mises en file et traitées dans le système ----
function bindInput(canvas: HTMLCanvasElement): void {
    const KEYS: Record<string, Action> = {
        ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
        w: "U", s: "D", a: "L", d: "R", " ": "*", Enter: "*",
        z: "undo", Backspace: "undo", r: "reset", n: "next", p: "prev",
    };
    window.addEventListener("keydown", (e) => {
        if (ui.mode !== "play") return;
        const k = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
        if (k) { push(k); e.preventDefault(); }
    });
    let start: [number, number] | null = null;
    canvas.addEventListener("pointerdown", (e) => { start = ui.mode === "play" ? [e.clientX, e.clientY] : null; });
    canvas.addEventListener("pointerup", (e) => {
        if (!start) return;
        const dx = e.clientX - start[0], dy = e.clientY - start[1];
        start = null;
        if (Math.hypot(dx, dy) < 20) { push("*"); return; }
        push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U");
    });
    // boutons du HUD (utiles au toucher) ; on rend le focus pour qu'Espace ne les rappuie pas
    for (const [id, a] of [["btn-undo", "undo"], ["btn-reset", "reset"]] as const)
        document.getElementById(id)!.addEventListener("click", (e) => { push(a); (e.currentTarget as HTMLElement).blur(); });
    document.getElementById("btn-pause")!.addEventListener("click", (e) => { ui.show("pause"); (e.currentTarget as HTMLElement).blur(); });
}

// Les déplacements tapés pendant une animation sont gardés (4 au plus, comme dans le lab) ; les autres
// actions (annuler, recommencer…) passent tout de suite.
function push(a: Action): void {
    const moves = game.queue.filter((q) => q.length === 1).length;
    if (a.length === 1 && moves >= 4) return;
    game.queue.push(a);
}

// ---- Construction de la scène à partir de l'état ----
function put(key: string, color: ColorName, y: number, scale: V3, opts: { mesh?: MeshHandle; yaw?: number } = {}): number {
    const world = game.world, eid = world.create(), t = cellOf(key, y);
    world.add(eid, Transform, { translation: t, rotation: eulerToQuat(0, opts.yaw ?? 0, 0), scale });
    world.add(eid, MeshInstance, opts.mesh ? { mesh: opts.mesh } : {});
    world.add(eid, MeshMaterial, game.mats[color]);
    game.spawned.push(eid);
    game.rest.set(eid, { t, s: scale });
    return eid;
}

function rebuild(intro: boolean): void {
    const world = game.world, s = game.state;
    for (const eid of game.spawned) world.destroy(eid);
    game.spawned = [];
    game.rest.clear();
    game.idAt.clear();
    game.doors = [];

    for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
        const k = `${r},${c}`;
        if (s.walls.has(k)) { put(k, "wall", 0.5, [1, 1, 1]); continue; }
        if (s.holes.has(k)) continue; // un trou : pas de sol
        put(k, k === s.exit ? "exit" : game.holes0.has(k) ? "filled" : "floor", -0.1, [0.96, 0.2, 0.96]);
        if (s.glass.has(k)) put(k, "glass", 0.4, [0.9, 0.8, 0.2]);
        if (s.switches.has(k)) put(k, "teal", 0.02, [0.5, 0.04, 0.5]);
        if (s.plates.has(k)) put(k, "teal", 0.02, [0.45, 0.04, 0.45], { yaw: Math.PI / 4 });
        if (s.doors.has(k)) {
            const d = s.open ? DOOR.open : DOOR.closed;
            game.doors.push(put(k, "teal", d.y, d.s));
        }
        if (s.defl.has(k)) put(k, "deflector", 0.25, [1.3, 0.5, 0.15], { yaw: s.defl.get(k) === "/" ? Math.PI / 4 : -Math.PI / 4 });
    }

    for (const [k, kind] of s.blocks as Map<string, string>) {
        const base = kind.replace("*", "");
        let eid: number;
        if (base === "R") eid = put(k, kind.endsWith("*") ? "sticky" : "round", 0.4, [0.8, 0.8, 0.8], { mesh: game.ball });
        else if (base === "S") eid = put(k, kind.endsWith("*") ? "sticky" : "square", 0.4, [0.8, 0.8, 0.8]);
        else if (base === "B") eid = put(k, "breakable", 0.4, [0.8, 0.8, 0.8]);
        else if (base === "I") eid = put(k, "fixed", 0.4, [0.85, 0.8, 0.85]);
        else if (base === "M" || base === "Mh" || base === "Mv") eid = put(k, "mirror", 0.4, base === "Mh" ? [0.8, 0.8, 0.3] : base === "Mv" ? [0.3, 0.8, 0.8] : [0.8, 0.8, 0.8]);
        else if (base === "Mz") eid = put(k, "teal", 0.4, [0.8, 0.8, 0.8]);
        else if (base[0] === "H") {
            // demi-carré : bloc aplati dans le sens de sa pointe
            const along = base[1] === "<" || base[1] === ">";
            eid = put(k, "half", 0.4, along ? [0.8, 0.8, 0.45] : [0.45, 0.8, 0.8]);
        } else eid = put(k, "square", 0.4, [0.8, 0.8, 0.8]);
        game.idAt.set(k, eid);
    }

    game.idAt.set("player", put(s.player as unknown as string, "player", 0.35, [0.6, 0.7, 0.6], { mesh: game.ball }));
    // l'œil indique la direction du joueur ; il le suit à chaque image (voir followEye)
    game.eye = put(s.player as unknown as string, "eye", 0.5, [0.2, 0.2, 0.2], { mesh: game.ball });

    game.anim = intro ? introTimeline() : null;
    hud();
}

// Arrivée d'un niveau : les cases poussent en vague depuis un coin, le joueur tombe en dernier
function introTimeline(): Timeline {
    const tl = new Timeline(), player = game.idAt.get("player")!;
    for (const eid of game.spawned) {
        if (eid === game.eye) continue;
        const { t, s } = game.rest.get(eid)!;
        const t0 = (t[0] + t[2] + 20) * 0.025 - 0.3 + (eid === player ? 0.25 : 0);
        tl.add({ eid, t0: 0, t1: 0, prop: "scale", from: [0, 0, 0], to: [0, 0, 0], ease: EASE.linear });
        tl.add({ eid, t0, t1: t0 + 0.35, prop: "scale", from: [0, 0, 0], to: s, ease: EASE.back });
        tl.add({ eid, t0, t1: t0 + 0.35, prop: "translation", from: [t[0], t[1] + (eid === player ? 2 : 0.6), t[2]], to: t, ease: EASE.out });
    }
    // on recale le début à 0
    const shift = Math.min(...tl.tweens.filter((w) => w.t1 > 0).map((w) => w.t0));
    for (const w of tl.tweens) if (w.t1 > 0) { w.t0 -= shift; w.t1 -= shift; }
    tl.end -= shift;
    return tl;
}

// ---- Un coup ----
function act(a: Action): void {
    if (a !== "next" && a !== "prev" && a !== "reset" && a !== "undo") return play(a);
    finishAnim();
    if (a === "next" || a === "prev") return startLevel(game.index + (a === "next" ? 1 : -1));
    if (a === "reset") return startLevel(game.index);
    const prev = game.history.pop();
    if (prev) { game.state = prev; game.won = false; rebuild(false); }
}

function play(m: Move): void {
    if (isWin(game.state)) return;
    const r = applyMove(game.state, m) as { state: State; events: any[]; bump?: string } | null;
    const player = game.idAt.get("player")!;
    const d = DIRS[{ U: "up", D: "down", L: "left", R: "right", "*": game.state.facing }[m] as keyof typeof DIRS];
    const facing: [number, number] = [d[1], d[0]];
    if (!r) {
        // coup impossible : le joueur se tourne et tressaille
        if (m !== "*") game.state = { ...game.state, facing: { U: "up", D: "down", L: "left", R: "right" }[m] } as State;
        const p = game.rest.get(player)!.t, tl = new Timeline();
        const amp: V3 = m === "*" ? [0.05, 0, 0] : [facing[0] * 0.08, 0, facing[1] * 0.08];
        tl.add({ eid: player, t0: 0, t1: 0.25, prop: "translation", from: p, to: p, ease: EASE.linear, osc: { amp, n: m === "*" ? 4 : 2, decay: true } });
        game.anim = tl;
        return;
    }
    const before = game.state;
    game.history.push(before);
    game.state = r.state;
    const T = game.world.storage(Transform);
    const tl = plan(r.events, r.bump, facing, {
        idAt: game.idAt,
        pos: (eid) => game.rest.get(eid)?.t ?? [T.translation.x.get(eid), T.translation.y.get(eid), T.translation.z.get(eid)],
        cell: cellOf,
        restY: (eid) => game.rest.get(eid)!.t[1],
        scale: (eid) => game.rest.get(eid)!.s,
    });
    // portes : elles s'ouvrent ou se ferment pendant le coup
    if (before.open !== game.state.open) {
        const from = before.open ? DOOR.open : DOOR.closed, to = game.state.open ? DOOR.open : DOOR.closed, t0 = Math.min(0.1, tl.end);
        for (const eid of game.doors) {
            const [x, , z] = game.rest.get(eid)!.t;
            tl.add({ eid, t0, t1: t0 + 0.22, prop: "translation", from: [x, from.y, z], to: [x, to.y, z], ease: EASE.inOut });
            tl.add({ eid, t0, t1: t0 + 0.22, prop: "scale", from: from.s, to: to.s, ease: EASE.inOut });
        }
    }
    game.anim = tl;
    hud();
}

// Applique l'image courante de l'animation, et mémorise les positions de repos à la fin
function sample(tl: Timeline): void {
    const T = game.world.storage(Transform);
    tl.sample((eid, prop, v) => {
        T[prop].set(eid, v[0], v[1], v[2]);
        if (tl.done) {
            const rest = game.rest.get(eid);
            if (rest) rest[prop === "translation" ? "t" : "s"] = v;
        }
    });
}

function finishAnim(): void {
    const tl = game.anim;
    if (!tl) return;
    tl.time = tl.end;
    sample(tl);
    game.anim = null;
    // filet de sécurité : si la scène ne correspond plus à l'état, on la reconstruit
    const blocks = game.state.blocks as Map<string, string>;
    if (blocks.size !== game.idAt.size - 1 || [...blocks.keys()].some((k) => !game.idAt.has(k))) rebuild(false);
    if (isWin(game.state) && !game.won) celebrate();
}

// Sortie atteinte : le joueur saute de joie, puis l'écran de victoire s'affiche
function celebrate(): void {
    game.won = true;
    progress.win(LEVELS[game.index].name, game.history.length);
    const player = game.idAt.get("player")!, p = game.rest.get(player)!.t, tl = new Timeline();
    tl.add({ eid: player, t0: 0, t1: 0.3, prop: "translation", from: p, to: p, ease: EASE.linear, arc: 0.6 });
    tl.add({ eid: player, t0: 0.3, t1: 0.55, prop: "translation", from: p, to: p, ease: EASE.linear, arc: 0.3 });
    tl.cue(0.65, () => { if (ui.mode === "play") ui.show("win"); });
    game.anim = tl;
}

// L'œil du joueur : devant lui, dans la direction où il regarde, à son échelle
function followEye(): void {
    const T = game.world.storage(Transform), player = game.idAt.get("player");
    if (player === undefined || game.eye < 0) return;
    const d = DIRS[game.state.facing as keyof typeof DIRS], k = T.scale.x.get(player) / 0.6;
    T.translation.set(game.eye, T.translation.x.get(player) + d[1] * 0.27 * k, T.translation.y.get(player) + 0.12 * k, T.translation.z.get(player) + d[0] * 0.27 * k);
    T.scale.set(game.eye, 0.2 * k, 0.2 * k, 0.2 * k);
}

// Taille de la vue orthographique pour que tout le niveau tienne à l'écran
const viewSize = (s: State) => Math.max(s.w * 0.75, s.h) + 2;

export const PuzzlePlugin: Plugin = {
    name: "Puzzle",
    // MeshPlugin doit être initialisé avant nous : on crée la boule avec Meshes.add
    dependencies: [MeshPlugin],
    initialize(world) {
        game.world = world;
        game.mats = Object.fromEntries(
            Object.entries(COLORS).map(([name, baseColor]) => [
                name,
                world.resource(Materials).add(StandardMaterial({ baseColor, perceptualRoughness: 0.6 })),
            ]),
        ) as Record<ColorName, MaterialHandle>;
        game.ball = world.resource(Meshes).add({ name: "boule", ...sphere(0.5, 24, 12) });

        Object.assign(world.resource(GlobalAmbientLight), { color: 0xfff4e6, brightness: 500 });
        const sun = world.create();
        world.add(sun, Transform, { rotation: lookAtRotation(0, 0, 0, 0.4, -2, -0.8) });
        world.add(sun, DirectionalLight, { color: 0xffe8cc, illuminance: 5000, shadowMapsEnabled: 1 });

        game.camera = world.create();
        world.add(game.camera, StandardRenderer);

        // vue plongeante (~70°) : les murs du bas masquent peu les cases derrière eux
        const eye: V3 = [0, 30, 11];
        world.add(game.camera, Camera, { clearColor: 0x191816, mode: CameraMode.Orthographic, near: -1000, far: 1000, size: 10 });
        world.add(game.camera, Transform, { translation: eye, rotation: lookAtRotation(...eye, 0, 0, 0) });
        const h = /^#niveau-(\d+)$/.exec(location.hash);
        startLevel(h ? +h[1] - 1 : progress.last); // règle la taille de la vue et construit la scène
        bindInput(document.querySelector("canvas") as HTMLCanvasElement);

        ui.init({
            play: (i) => { finishAnim(); startLevel(i); },
            current: () => game.index,
            moves: () => game.history.length,
        });
    },
    systems: [
        {
            name: "Puzzle/Play",
            update(world: World) {
                if (ui.mode !== "play") game.queue = [];
                // une action autre qu'un déplacement (annuler, recommencer…) passe sans attendre la fin de l'animation
                if (game.queue.length && game.queue[0].length > 1) act(game.queue.shift()!);
                if (game.anim) {
                    // plus vite quand des coups attendent
                    const speed = SPEED[progress.speed] * (game.queue.length ? 2.5 : 1);
                    game.anim.time += Number.isFinite(speed) ? world.time.realDeltaTime * speed : game.anim.end;
                    if (game.anim.done) finishAnim();
                    else sample(game.anim);
                }
                if (!game.anim && game.queue.length) {
                    act(game.queue.shift()!);
                    if (game.anim && progress.speed === "aucune") finishAnim();
                }
                followEye();
            },
        },
    ],
};
