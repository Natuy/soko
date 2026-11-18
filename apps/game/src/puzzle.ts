// Habillage Shallot du jeu. Aucune règle ici : chaque coup passe par packages/core,
// puis la scène est reconstruite à partir du nouvel état. C'est volontairement brut
// (pas d'animation) : c'est le point de départ pour l'habillage 3D.
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
import { applyMove, isWin, LEVELS, parseLevel } from "../../../packages/core/src/index.js";

type Move = "U" | "D" | "L" | "R" | "*";
type State = ReturnType<typeof parseLevel>;

const COLORS = {
    floor: [0.84, 0.79, 0.7, 1],
    wall: [0.29, 0.25, 0.22, 1],
    exit: [0.91, 0.7, 0.23, 1],
    square: [0.78, 0.41, 0.25, 1],
    round: [0.25, 0.5, 0.66, 1],
    player: [0.18, 0.54, 0.36, 1],
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

// ---- État de la partie (hors ECS : c'est le modèle, la scène n'en est qu'une vue) ----
const game = {
    index: 0,
    state: null as unknown as State,
    history: [] as State[],
    queue: [] as (Move | "undo" | "reset" | "next" | "prev")[],
    dirty: true,
    spawned: [] as number[],
};

function startLevel(i: number): void {
    game.index = (i + LEVELS.length) % LEVELS.length;
    game.state = parseLevel(LEVELS[game.index].map);
    game.history = [];
    game.dirty = true;
    try { history.replaceState(null, "", `#niveau-${game.index + 1}`); } catch {}
}

function hud(): void {
    const l = LEVELS[game.index];
    (document.getElementById("world") as HTMLElement).textContent = l.world;
    (document.getElementById("name") as HTMLElement).textContent = `${game.index + 1}. ${l.name}`;
    (document.getElementById("moves") as HTMLElement).textContent = isWin(game.state)
        ? "Sortie atteinte ! (N : suivant)"
        : `${game.history.length} coups`;
}

// ---- Entrées : clavier + glisser/toucher, mises en file et traitées dans le système ----
function bindInput(canvas: HTMLCanvasElement): void {
    const KEYS: Record<string, (typeof game.queue)[number]> = {
        ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
        w: "U", s: "D", a: "L", d: "R", " ": "*", Enter: "*",
        z: "undo", Backspace: "undo", r: "reset", n: "next", p: "prev",
    };
    window.addEventListener("keydown", (e) => {
        const k = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
        if (k) { game.queue.push(k); e.preventDefault(); }
    });
    let start: [number, number] | null = null;
    canvas.addEventListener("pointerdown", (e) => { start = [e.clientX, e.clientY]; });
    canvas.addEventListener("pointerup", (e) => {
        if (!start) return;
        const dx = e.clientX - start[0], dy = e.clientY - start[1];
        start = null;
        if (Math.hypot(dx, dy) < 20) { game.queue.push("*"); return; }
        game.queue.push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U");
    });
}

// ---- Construction de la scène à partir de l'état ----
function rebuild(world: World, mats: Record<ColorName, MaterialHandle>, ball: MeshHandle): void {
    for (const eid of game.spawned) world.destroy(eid);
    game.spawned = [];
    const s = game.state;
    const cx = (s.w - 1) / 2, cz = (s.h - 1) / 2;

    const put = (key: string, color: ColorName, y: number, scale: [number, number, number], opts: { mesh?: MeshHandle; yaw?: number } = {}) => {
        const [r, c] = key.split(",").map(Number);
        const eid = world.create();
        world.add(eid, Transform, {
            translation: [c - cx, y, r - cz],
            rotation: eulerToQuat(0, opts.yaw ?? 0, 0),
            scale,
        });
        world.add(eid, MeshInstance, opts.mesh ? { mesh: opts.mesh } : {});
        world.add(eid, MeshMaterial, mats[color]);
        game.spawned.push(eid);
    };

    for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
        const k = `${r},${c}`;
        if (s.walls.has(k)) { put(k, "wall", 0.5, [1, 1, 1]); continue; }
        if (s.holes.has(k)) continue; // un trou : pas de sol
        put(k, k === s.exit ? "exit" : "floor", -0.1, [0.96, 0.2, 0.96]);
        if (s.glass.has(k)) put(k, "glass", 0.4, [0.9, 0.8, 0.2]);
        if (s.switches.has(k)) put(k, "teal", 0.02, [0.5, 0.04, 0.5]);
        if (s.plates.has(k)) put(k, "teal", 0.02, [0.45, 0.04, 0.45], { yaw: Math.PI / 4 });
        if (s.doors.has(k)) put(k, "teal", s.open ? 0.03 : 0.45, s.open ? [0.9, 0.06, 0.9] : [0.9, 0.9, 0.9]);
        if (s.defl.has(k)) put(k, "deflector", 0.25, [1.3, 0.5, 0.15], { yaw: s.defl.get(k) === "/" ? Math.PI / 4 : -Math.PI / 4 });
    }

    for (const [k, kind] of s.blocks as Map<string, string>) {
        const base = kind.replace("*", "");
        if (base === "R") put(k, kind.endsWith("*") ? "sticky" : "round", 0.4, [0.8, 0.8, 0.8], { mesh: ball });
        else if (base === "S") put(k, kind.endsWith("*") ? "sticky" : "square", 0.4, [0.8, 0.8, 0.8]);
        else if (base === "B") put(k, "breakable", 0.4, [0.8, 0.8, 0.8]);
        else if (base === "I") put(k, "fixed", 0.4, [0.85, 0.8, 0.85]);
        else if (base === "M" || base === "Mh" || base === "Mv") put(k, "mirror", 0.4, base === "Mh" ? [0.8, 0.8, 0.3] : base === "Mv" ? [0.3, 0.8, 0.8] : [0.8, 0.8, 0.8]);
        else if (base === "Mz") put(k, "teal", 0.4, [0.8, 0.8, 0.8]);
        else if (base[0] === "H") {
            // demi-carré : bloc aplati dans le sens de sa pointe
            const along = base[1] === "<" || base[1] === ">";
            put(k, "half", 0.4, along ? [0.8, 0.8, 0.45] : [0.45, 0.8, 0.8]);
        } else put(k, "square", 0.4, [0.8, 0.8, 0.8]);
    }

    put(s.player as unknown as string, "player", 0.35, [0.6, 0.7, 0.6], { mesh: ball });
    hud();
}

// Taille de la vue orthographique pour que tout le niveau tienne à l'écran
const viewSize = (s: State) => Math.max(s.w * 0.75, s.h) + 2;

export const PuzzlePlugin: Plugin = {
    name: "Puzzle",
    // MeshPlugin doit être initialisé avant nous : on crée la boule avec Meshes.add
    dependencies: [MeshPlugin],
    initialize(world) {
        const mats = Object.fromEntries(
            Object.entries(COLORS).map(([name, baseColor]) => [
                name,
                world.resource(Materials).add(StandardMaterial({ baseColor, perceptualRoughness: 0.6 })),
            ]),
        ) as Record<ColorName, MaterialHandle>;
        const ball = world.resource(Meshes).add({ name: "boule", ...sphere(0.5, 24, 12) });

        Object.assign(world.resource(GlobalAmbientLight), { color: 0xfff4e6, brightness: 500 });
        const sun = world.create();
        world.add(sun, Transform, { rotation: lookAtRotation(0, 0, 0, 0.4, -2, -0.8) });
        world.add(sun, DirectionalLight, { color: 0xffe8cc, illuminance: 5000, shadowMapsEnabled: 1 });

        const camera = world.create();
        world.add(camera, StandardRenderer);

        const h = /^#niveau-(\d+)$/.exec(location.hash);
        startLevel(h ? +h[1] - 1 : 0);
        const eye: [number, number, number] = [0, 30, 18];
        world.add(camera, Camera, { clearColor: 0x191816, mode: CameraMode.Orthographic, near: -1000, far: 1000, size: viewSize(game.state) });
        world.add(camera, Transform, { translation: eye, rotation: lookAtRotation(...eye, 0, 0, 0) });
        bindInput(document.querySelector("canvas") as HTMLCanvasElement);

        Object.assign(game, { mats, ball, camera });
    },
    systems: [
        {
            name: "Puzzle/Play",
            update(world: World) {
                const g = game as typeof game & { mats: Record<ColorName, MaterialHandle>; ball: MeshHandle; camera: number };
                while (game.queue.length) {
                    const a = game.queue.shift()!;
                    if (a === "next" || a === "prev") { startLevel(game.index + (a === "next" ? 1 : -1)); world.storage(Camera).size.set(g.camera, viewSize(game.state)); continue; }
                    if (a === "reset") { startLevel(game.index); continue; }
                    if (a === "undo") { const prev = game.history.pop(); if (prev) { game.state = prev; game.dirty = true; } continue; }
                    if (isWin(game.state)) continue;
                    const r = applyMove(game.state, a);
                    if (r) { game.history.push(game.state); game.state = r.state; game.dirty = true; }
                }
                if (game.dirty) { game.dirty = false; rebuild(world, g.mats, g.ball); }
            },
        },
    ],
};
