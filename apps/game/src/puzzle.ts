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
import { applyMove, DIRS, isWin, LEVELS, parseLevel, WORLDS } from "../../../packages/core/src/index.js";
import { Bloom, BloomPlugin } from "@dylanebert/shallot/extras";
import { EASE, plan, Timeline, type V3 } from "./anim";
import { bevelBox, wedge } from "./meshes";
import { progress, ui } from "./menus";

type Move = "U" | "D" | "L" | "R" | "*";
type Action = Move | "undo" | "reset" | "next" | "prev";
type State = ReturnType<typeof parseLevel>;

type RGBA = [number, number, number, number];
// Matériaux. Ceux du décor (sol, murs, trous) sont recolorés selon le monde (voir THEMES).
const COLORS = {
    floor: [0.84, 0.79, 0.7, 1],
    floorAo1: [0.84, 0.79, 0.7, 1],
    floorAo2: [0.84, 0.79, 0.7, 1],
    filled: [0.66, 0.6, 0.52, 1],
    wall: [0.29, 0.25, 0.22, 1],
    wallTop: [0.36, 0.31, 0.27, 1],
    pitWall: [0.2, 0.17, 0.15, 1],
    pitMid: [0.14, 0.12, 0.1, 1],
    pitDeep: [0.08, 0.07, 0.06, 1],
    exit: [0.91, 0.7, 0.23, 1],
    exitRing: [1, 0.85, 0.45, 1],
    spark: [1, 0.9, 0.6, 1],
    square: [0.78, 0.41, 0.25, 1],
    squareTop: [0.86, 0.52, 0.34, 1],
    round: [0.25, 0.5, 0.66, 1],
    roundBand: [0.17, 0.36, 0.5, 1],
    player: [0.18, 0.54, 0.36, 1],
    eye: [0.1, 0.12, 0.1, 1],
    breakable: [0.89, 0.76, 0.37, 1],
    crack: [0.36, 0.26, 0.12, 1],
    half: [0.48, 0.37, 0.65, 1],
    halfTop: [0.62, 0.5, 0.8, 1],
    sticky: [0.55, 0.78, 0.25, 1],
    stickyDrop: [0.4, 0.62, 0.14, 1],
    glue: [0.52, 0.8, 0.2, 1],
    mirror: [0.36, 0.43, 0.5, 1],
    mirrorFace: [0.85, 0.92, 0.98, 1],
    mirrorBar: [0.3, 0.36, 0.42, 1],
    fixed: [0.33, 0.35, 0.38, 1],
    rivet: [0.6, 0.62, 0.66, 1],
    teal: [0.23, 0.6, 0.56, 1],
    deflector: [0.37, 0.32, 0.27, 1],
    glass: [0.6, 0.8, 0.9, 1],
} satisfies Record<string, RGBA>;
type ColorName = keyof typeof COLORS;
// Réglages de matériau autres que la couleur (émissif ≈ 1 : blanc plein, au-delà le bloom déborde)
const MAT_OPTS: Partial<Record<ColorName, { emissive?: V3; metallic?: number; perceptualRoughness?: number }>> = {
    exit: { emissive: [1.1, 0.7, 0.15] },
    exitRing: { emissive: [2.2, 1.5, 0.5] },
    spark: { emissive: [3, 2.2, 0.8] },
    mirrorFace: { metallic: 0.9, perceptualRoughness: 0.12, emissive: [0.12, 0.16, 0.2] },
    fixed: { metallic: 0.5, perceptualRoughness: 0.45 },
    rivet: { metallic: 0.8, perceptualRoughness: 0.3 },
    sticky: { perceptualRoughness: 0.25 },
    stickyDrop: { perceptualRoughness: 0.15 },
    glue: { perceptualRoughness: 0.1, emissive: [0.04, 0.08, 0.0] },
};

// ---- Ambiance par monde : couleurs du décor, fond et lumière ----
interface Theme { floor: V3; wall: V3; bg: number; sun: number; sunLux: number; ambient: number; ambientLux: number }
const THEMES: Theme[] = [
    // Monde 1 · atelier : bois clair et briques chaudes
    { floor: [0.84, 0.79, 0.7], wall: [0.29, 0.25, 0.22], bg: 0x191816, sun: 0xffe8cc, sunLux: 5000, ambient: 0xfff4e6, ambientLux: 500 },
    // Monde 2 · carrière : grès et terre cuite
    { floor: [0.87, 0.75, 0.6], wall: [0.45, 0.28, 0.2], bg: 0x1e1511, sun: 0xffd6a8, sunLux: 5400, ambient: 0xffe6d0, ambientLux: 470 },
    // Monde 3 · serre : dalles vert pâle, murs de mousse
    { floor: [0.77, 0.83, 0.71], wall: [0.2, 0.31, 0.24], bg: 0x121a14, sun: 0xf2ffe0, sunLux: 4800, ambient: 0xe8ffe8, ambientLux: 520 },
    // Monde 4 · palais des glaces : marbre froid, ardoise bleutée
    { floor: [0.8, 0.84, 0.9], wall: [0.22, 0.27, 0.36], bg: 0x11151d, sun: 0xe2edff, sunLux: 5200, ambient: 0xe6eeff, ambientLux: 520 },
    // Monde 5 · crépuscule : lavande et prune, lumière rasante orangée
    { floor: [0.8, 0.74, 0.83], wall: [0.3, 0.2, 0.34], bg: 0x17111c, sun: 0xffc4a0, sunLux: 5000, ambient: 0xd6c8ff, ambientLux: 480 },
];
const shade = (c: V3, k: number): RGBA => [c[0] * k, c[1] * k, c[2] * k, 1];

const SPEED = { normale: 1, rapide: 1.8, aucune: Infinity } as const;
const DOOR = { open: { y: 0.03, s: [0.9, 0.06, 0.9] as V3 }, closed: { y: 0.45, s: [0.9, 0.9, 0.9] as V3 } };

// Petite pièce qui suit un bloc (rayure, fissure, rivet…) : Shallot n'a pas de hiérarchie,
// on recopie donc la position et l'échelle du parent à chaque image.
interface Part { eid: number; parent: number; off: V3; s: V3; base: number }
// Pont de colle entre deux blocs collés : suit ses deux blocs, apparaît en gonflant
interface Bridge { eid: number; a: number; b: number; axis: "x" | "z"; age: number; baseA: number; baseB: number }
// Étincelle : sort de la sortie en continu, ou jaillit quand le joueur l'atteint
interface Spark { eid: number; p: V3; v: V3; age: number; life: number; size: number; loop: boolean }

// ---- État de la partie (hors ECS : c'est le modèle, la scène n'en est qu'une vue) ----
const game = {
    world: null as unknown as World,
    mats: null as unknown as Record<ColorName, MaterialHandle>,
    ball: null as unknown as MeshHandle,
    wedge: null as unknown as MeshHandle,
    bevel: null as unknown as MeshHandle,
    sun: 0,
    theme: -1,
    parts: [] as Part[],
    sparks: [] as Spark[],
    exitRing: -1,
    clock: 0,
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
    kindOf: new Map<number, string>(), // genre de bloc affiché par chaque entité (un collant qui colle change de genre)
    glue: new Map<string, Bridge>(), // "entitéA|entitéB" → pont
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
    ui.card(game.index);
    try { history.replaceState(null, "", `#niveau-${game.index + 1}`); } catch {}
    if (game.world) {
        game.world.storage(Camera).size.set(game.camera, viewSize(game.state));
        applyTheme(Math.max(0, WORLDS.findIndex((w) => w.world === LEVELS[game.index].world)));
        rebuild(true);
    }
}

// Recolore le décor et règle fond et lumière pour le monde du niveau
function applyTheme(i: number): void {
    const t = THEMES[i % THEMES.length], world = game.world;
    if (game.theme === i) return;
    game.theme = i;
    const mats = world.resource(Materials), set = (name: ColorName, c: RGBA) => mats.update(game.mats[name], { baseColor: c });
    // les cases bordées de murs sont plus sombres : une occlusion ambiante « cuite » dans la couleur
    set("floor", shade(t.floor, 1));
    set("floorAo1", shade(t.floor, 0.89));
    set("floorAo2", shade(t.floor, 0.78));
    set("filled", shade(t.floor, 0.72));
    set("wall", shade(t.wall, 1));
    set("wallTop", shade(t.wall, 1.28));
    set("pitWall", shade(t.wall, 0.62));
    set("pitMid", shade(t.wall, 0.4));
    set("pitDeep", shade(t.wall, 0.22));
    world.storage(Camera).clearColor.set(game.camera, t.bg);
    world.storage(DirectionalLight).color.set(game.sun, t.sun);
    world.storage(DirectionalLight).illuminance.set(game.sun, t.sunLux);
    Object.assign(world.resource(GlobalAmbientLight), { color: t.ambient, brightness: t.ambientLux });
    document.body.style.background = `#${t.bg.toString(16).padStart(6, "0")}`;
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
function spawn(t: V3, color: ColorName, scale: V3, opts: { mesh?: MeshHandle; yaw?: number } = {}): number {
    const world = game.world, eid = world.create();
    world.add(eid, Transform, { translation: t, rotation: eulerToQuat(0, opts.yaw ?? 0, 0), scale });
    world.add(eid, MeshInstance, opts.mesh ? { mesh: opts.mesh } : {});
    world.add(eid, MeshMaterial, game.mats[color]);
    return eid;
}

function put(key: string, color: ColorName, y: number, scale: V3, opts: { mesh?: MeshHandle; yaw?: number; dx?: number; dz?: number } = {}): number {
    const t = cellOf(key, y);
    t[0] += opts.dx ?? 0;
    t[2] += opts.dz ?? 0;
    const eid = spawn(t, color, scale, opts);
    game.spawned.push(eid);
    game.rest.set(eid, { t, s: scale });
    return eid;
}

// Ajoute une pièce à un bloc ; off est le décalage depuis son centre, au repos
function part(parent: number, color: ColorName, off: V3, scale: V3, opts: { mesh?: MeshHandle; yaw?: number } = {}): void {
    const r = game.rest.get(parent)!;
    const eid = spawn([r.t[0] + off[0], r.t[1] + off[1], r.t[2] + off[2]], color, scale, opts);
    game.spawned.push(eid);
    game.parts.push({ eid, parent, off, s: scale, base: r.s[0] });
}

// Un bloc et ses détails : chaque mécanique a une silhouette qui se lit sans légende
const ARROW_DIR: Record<string, [number, number, number]> = { ">": [1, 0, 0], "<": [-1, 0, Math.PI], v: [0, 1, -Math.PI / 2], "^": [0, -1, Math.PI / 2] };
function putBlock(k: string, kind: string): number {
    const base = kind.replace("*", ""), sticky = kind.endsWith("*"), top = 0.405;
    const drops = (eid: number, y: number) => {
        for (const [x, z, s] of [[-0.17, -0.12, 0.15], [0.16, -0.05, 0.12], [-0.02, 0.17, 0.13]])
            part(eid, "stickyDrop", [x, y, z], [s, s * 0.7, s], { mesh: game.ball });
    };
    if (base === "R") {
        const eid = put(k, sticky ? "sticky" : "round", 0.4, [0.8, 0.8, 0.8], { mesh: game.ball });
        part(eid, sticky ? "stickyDrop" : "roundBand", [0, 0, 0], [0.83, 0.13, 0.83], { mesh: game.ball }); // rayure de bille
        if (sticky) drops(eid, 0.33);
        return eid;
    }
    if (base[0] === "H") {
        // demi-carré : un coin qui pointe dans le seul sens où il avance
        const [dx, dz, yaw] = ARROW_DIR[base[1]];
        const eid = put(k, "half", 0.4, [0.8, 0.8, 0.8], { mesh: game.wedge, yaw });
        part(eid, "halfTop", [-dx * 0.05, top, -dz * 0.05], [0.5, 0.03, 0.5], { mesh: game.wedge, yaw });
        return eid;
    }
    if (base === "B") {
        // cassant : fissures sur le dessus et la face avant
        const eid = put(k, "breakable", 0.4, [0.8, 0.8, 0.8], { mesh: game.bevel });
        for (const [x, z, l, yaw] of [[-0.1, -0.08, 0.34, 0.5], [0.11, 0.07, 0.3, -0.7], [0.03, -0.18, 0.18, 1.3], [-0.14, 0.15, 0.16, -1.1]])
            part(eid, "crack", [x, top, z], [l, 0.02, 0.035], { yaw });
        part(eid, "crack", [0.08, 0.05, top], [0.035, 0.36, 0.02], { yaw: 0.25 });
        return eid;
    }
    if (base === "I") {
        // inamovible : métal sombre et rivets
        const eid = put(k, "fixed", 0.4, [0.85, 0.8, 0.85], { mesh: game.bevel });
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(eid, "rivet", [x * 0.26, 0.41, z * 0.26], [0.1, 0.06, 0.1], { mesh: game.ball });
        return eid;
    }
    if (base[0] === "M") {
        // miroirs : cadre et face réfléchissante ; la barre dit dans quel sens il agit (comme dans le lab)
        const eid = put(k, base === "Mz" ? "teal" : "mirror", 0.4, [0.8, 0.8, 0.8], { mesh: game.bevel });
        part(eid, "mirrorFace", [0, top, 0], [0.56, 0.03, 0.56]);
        if (base === "Mh") part(eid, "mirrorBar", [0, top + 0.015, 0], [0.46, 0.03, 0.08]);
        if (base === "Mv") part(eid, "mirrorBar", [0, top + 0.015, 0], [0.08, 0.03, 0.46]);
        return eid;
    }
    // carré (et collant carré)
    const eid = put(k, sticky ? "sticky" : "square", 0.4, [0.8, 0.8, 0.8], { mesh: game.bevel });
    part(eid, sticky ? "stickyDrop" : "squareTop", [0, top, 0], [0.5, 0.03, 0.5]);
    if (sticky) drops(eid, 0.43);
    return eid;
}

function placeBlock(k: string, kind: string): number {
    const eid = putBlock(k, kind);
    game.kindOf.set(eid, kind);
    return eid;
}

// Remplace l'entité d'un bloc (et ses pièces) quand son genre a changé
function replaceBlock(k: string, kind: string): void {
    const old = game.idAt.get(k)!, gone = new Set([old, ...game.parts.filter((p) => p.parent === old).map((p) => p.eid)]);
    for (const eid of gone) game.world.destroy(eid);
    game.parts = game.parts.filter((p) => !gone.has(p.eid));
    game.spawned = game.spawned.filter((e) => !gone.has(e));
    game.rest.delete(old);
    game.kindOf.delete(old);
    game.idAt.set(k, placeBlock(k, kind));
}

// Met la scène d'accord avec la colle de l'état : un collant qui s'est collé perd ses gouttes
// (il n'est plus collant), et chaque paire de blocs collés reçoit un pont de colle.
function syncGlue(pop: boolean): void {
    const s = game.state;
    for (const [k, kind] of s.blocks as Map<string, string>) {
        const eid = game.idAt.get(k);
        if (eid !== undefined && game.kindOf.get(eid) !== kind) replaceBlock(k, kind);
    }
    const want = new Map<string, [number, number, "x" | "z"]>();
    for (const e of s.glue as Set<string>) {
        const [ka, kb] = e.split("|"), a = game.idAt.get(ka), b = game.idAt.get(kb);
        if (a === undefined || b === undefined) continue;
        want.set(a < b ? `${a}|${b}` : `${b}|${a}`, [a, b, ka.split(",")[0] === kb.split(",")[0] ? "x" : "z"]);
    }
    for (const [key, br] of game.glue) if (!want.has(key)) { game.world.destroy(br.eid); game.glue.delete(key); }
    for (const [key, [a, b, axis]] of want) {
        if (game.glue.has(key)) continue;
        const eid = spawn(game.rest.get(a)!.t, "glue", [0, 0, 0]);
        game.glue.set(key, { eid, a, b, axis, age: pop ? 0 : 1, baseA: game.rest.get(a)!.s[0], baseB: game.rest.get(b)!.s[0] });
    }
}

// Les ponts se placent entre leurs deux blocs et prennent la plus petite de leurs échelles
function followGlue(dt: number): void {
    const T = game.world.storage(Transform), tr = T.translation, sc = T.scale;
    for (const br of game.glue.values()) {
        br.age += dt;
        const grow = br.age < 0.3 ? EASE.back(br.age / 0.3) : 1;
        const k = Math.min(sc.x.get(br.a) / br.baseA, sc.x.get(br.b) / br.baseB) * grow;
        tr.set(br.eid, (tr.x.get(br.a) + tr.x.get(br.b)) / 2, (tr.y.get(br.a) + tr.y.get(br.b)) / 2 + 0.04, (tr.z.get(br.a) + tr.z.get(br.b)) / 2);
        const [lx, lz] = br.axis === "x" ? [0.46, 0.42] : [0.42, 0.46];
        sc.set(br.eid, lx * k, 0.58 * k, lz * k);
    }
}

// Trou : une fosse avec un fond sombre et des parois dégradées, plutôt qu'un vide
function putPit(k: string): void {
    const s = game.state, [r, c] = k.split(",").map(Number);
    put(k, "pitDeep", -1.05, [1, 0.1, 1]);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (s.holes.has(`${r + dr},${c + dc}`)) continue; // fosse voisine : pas de paroi entre les deux
        const along = dr !== 0, off = { dx: dc * 0.46, dz: dr * 0.46 };
        put(k, "pitWall", -0.32, along ? [1, 0.44, 0.08] : [0.08, 0.44, 1], off);
        put(k, "pitMid", -0.77, along ? [1, 0.46, 0.08] : [0.08, 0.46, 1], off);
    }
}

// Sortie : dalle lumineuse cerclée d'un liseré qui pulse, et des étincelles qui montent
function putExit(k: string): void {
    put(k, "exit", -0.1, [0.96, 0.2, 0.96]);
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]])
        put(k, "exitRing", 0.01, dz ? [0.9, 0.03, 0.06] : [0.06, 0.03, 0.78], { dx: dx * 0.42, dz: dz * 0.42 });
    const [x, , z] = cellOf(k, 0);
    for (let i = 0; i < 6; i++) addSpark([x, 0, z], [0, 0, 0], 1.4, 0.06, true, i / 6);
}

function addSpark(p: V3, v: V3, life: number, size: number, loop: boolean, phase = 0): void {
    const eid = spawn([...p], "spark", [0, 0, 0], { mesh: game.ball });
    const sp: Spark = { eid, p: [...p], v, age: phase * life, life, size, loop };
    if (loop) respawn(sp, p);
    game.sparks.push(sp);
}
// Une étincelle de la sortie renaît au ras de la dalle, à une place au hasard
function respawn(sp: Spark, center: V3): void {
    sp.p = [center[0] + (Math.random() - 0.5) * 0.6, 0.05, center[2] + (Math.random() - 0.5) * 0.6];
    sp.v = [0, 0.55 + Math.random() * 0.35, 0];
    sp.life = 1.1 + Math.random() * 0.7;
}

function updateSparks(dt: number): void {
    const T = game.world.storage(Transform), exit = game.state.exit ? cellOf(game.state.exit, 0) : null;
    game.sparks = game.sparks.filter((sp) => {
        sp.age += dt;
        if (sp.age >= sp.life) {
            if (!sp.loop || !exit) { game.world.destroy(sp.eid); return false; }
            sp.age -= sp.life;
            respawn(sp, exit);
        }
        if (!sp.loop) sp.v[1] -= 7 * dt; // gravité pour la gerbe de victoire
        for (let i = 0; i < 3; i++) sp.p[i] += sp.v[i] * dt;
        const a = sp.age / sp.life, k = sp.size * Math.min(1, a * 6) * (1 - a);
        T.translation.set(sp.eid, sp.p[0], sp.p[1], sp.p[2]);
        T.scale.set(sp.eid, k, k, k);
        return true;
    });
}

// Gerbe d'étincelles quand le joueur atteint la sortie
function burst(at: V3): void {
    for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 1.6;
        addSpark([at[0], at[1] + 0.2, at[2]], [Math.cos(a) * sp, 2.2 + Math.random() * 1.8, Math.sin(a) * sp], 0.7 + Math.random() * 0.5, 0.08 + Math.random() * 0.05, false);
    }
}

// Occlusion ambiante « cuite » : une case bordée de murs reçoit un sol plus sombre
function floorShade(r: number, c: number): ColorName {
    const w = game.state.walls, has = (dr: number, dc: number) => w.has(`${r + dr},${c + dc}`) ? 1 : 0;
    const score = has(-1, 0) + has(1, 0) + has(0, -1) + has(0, 1) + 0.5 * (has(-1, -1) + has(-1, 1) + has(1, -1) + has(1, 1));
    return score >= 2 ? "floorAo2" : score >= 0.75 ? "floorAo1" : "floor";
}

function rebuild(intro: boolean): void {
    const world = game.world, s = game.state;
    for (const eid of game.spawned) world.destroy(eid);
    for (const sp of game.sparks) world.destroy(sp.eid);
    for (const br of game.glue.values()) world.destroy(br.eid);
    game.glue.clear();
    game.kindOf.clear();
    game.spawned = [];
    game.parts = [];
    game.sparks = [];
    game.rest.clear();
    game.idAt.clear();
    game.doors = [];

    for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
        const k = `${r},${c}`;
        if (s.walls.has(k)) {
            put(k, "wall", 0.5, [1, 1, 1]);
            put(k, "wallTop", 1.0, [0.86, 0.04, 0.86]); // dessus en relief : les murs se lisent d'en haut
            continue;
        }
        if (s.holes.has(k)) { putPit(k); continue; }
        if (k === s.exit) putExit(k);
        else put(k, game.holes0.has(k) ? "filled" : floorShade(r, c), -0.1, [0.96, 0.2, 0.96]);
        if (s.glass.has(k)) put(k, "glass", 0.4, [0.9, 0.8, 0.2]);
        if (s.switches.has(k)) put(k, "teal", 0.02, [0.5, 0.04, 0.5]);
        if (s.plates.has(k)) put(k, "teal", 0.02, [0.45, 0.04, 0.45], { yaw: Math.PI / 4 });
        if (s.doors.has(k)) {
            const d = s.open ? DOOR.open : DOOR.closed;
            game.doors.push(put(k, "teal", d.y, d.s));
        }
        if (s.defl.has(k)) put(k, "deflector", 0.25, [1.3, 0.5, 0.15], { yaw: s.defl.get(k) === "/" ? Math.PI / 4 : -Math.PI / 4 });
    }

    for (const [k, kind] of s.blocks as Map<string, string>) game.idAt.set(k, placeBlock(k, kind));

    game.idAt.set("player", put(s.player as unknown as string, "player", 0.35, [0.6, 0.7, 0.6], { mesh: game.ball }));
    // l'œil indique la direction du joueur ; il le suit à chaque image (voir followEye)
    game.eye = put(s.player as unknown as string, "eye", 0.5, [0.2, 0.2, 0.2], { mesh: game.ball });

    syncGlue(false);
    game.anim = intro ? introTimeline() : null;
    hud();
}

// Arrivée d'un niveau : la caméra recule puis se pose, le sol monte en vague depuis le joueur,
// les blocs tombent dessus, et le joueur atterrit en dernier en s'écrasant un peu.
function introTimeline(): Timeline {
    const tl = new Timeline(), player = game.idAt.get("player")!, P = game.rest.get(player)!.t;
    const blocks = new Set(game.idAt.values()), wave = 0.035;
    let far = 0;
    for (const eid of game.rest.keys()) {
        if (eid === game.eye || eid === player) continue;
        const { t, s } = game.rest.get(eid)!, d = Math.hypot(t[0] - P[0], t[2] - P[2]);
        far = Math.max(far, d);
        const block = blocks.has(eid), t0 = (block ? 0.25 : 0) + d * wave, dur = block ? 0.45 : 0.42;
        tl.add({ eid, t0: 0, t1: 0, prop: "scale", from: [0, 0, 0], to: [0, 0, 0], ease: EASE.linear });
        tl.add({ eid, t0, t1: t0 + dur * 0.7, prop: "scale", from: [0, 0, 0], to: s, ease: EASE.back });
        tl.add({ eid, t0, t1: t0 + dur, prop: "translation", from: [t[0], t[1] + (block ? 1.6 : -1.5), t[2]], to: t, ease: block ? EASE.bounce : EASE.out });
    }
    // le joueur tombe du ciel et rebondit
    const { s } = game.rest.get(player)!, land = 0.3 + far * wave, fall = 0.6;
    tl.add({ eid: player, t0: 0, t1: 0, prop: "scale", from: [0, 0, 0], to: [0, 0, 0], ease: EASE.linear });
    tl.add({ eid: player, t0: land, t1: land, prop: "scale", from: s, to: s, ease: EASE.linear });
    tl.add({ eid: player, t0: land, t1: land + fall, prop: "translation", from: [P[0], P[1] + 5, P[2]], to: P, ease: EASE.bounce });
    const squash: V3 = [s[0] * 1.3, s[1] * 0.6, s[2] * 1.3];
    tl.add({ eid: player, t0: land + fall * 0.36, t1: land + fall * 0.46, prop: "scale", from: s, to: squash, ease: EASE.out });
    tl.add({ eid: player, t0: land + fall * 0.46, t1: land + fall * 0.7, prop: "scale", from: squash, to: s, ease: EASE.back });
    // la caméra part de plus loin
    const cam = game.world.storage(Camera).size, size = viewSize(game.state);
    tl.track(0, land + fall * 0.5, size * 1.4, size, EASE.inOut, (v) => cam.set(game.camera, v));
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
    else syncGlue(true);
    if (isWin(game.state) && !game.won) celebrate();
}

// Sortie atteinte : le joueur saute de joie puis se fond dans la lumière de la sortie,
// le niveau se défait en vague depuis la sortie, et l'écran de victoire s'affiche.
function celebrate(): void {
    game.won = true;
    progress.win(LEVELS[game.index].name, game.history.length);
    const player = game.idAt.get("player")!, { t: p, s } = game.rest.get(player)!, tl = new Timeline();
    burst(p);
    tl.add({ eid: player, t0: 0, t1: 0.34, prop: "translation", from: p, to: p, ease: EASE.linear, arc: 0.7 });
    tl.add({ eid: player, t0: 0.34, t1: 0.62, prop: "translation", from: p, to: [p[0], 0, p[2]], ease: EASE.in });
    tl.add({ eid: player, t0: 0.34, t1: 0.62, prop: "scale", from: s, to: [0, 0, 0], ease: EASE.in });
    tl.cue(0.6, () => {
        burst([p[0], -0.1, p[2]]);
        for (const sp of game.sparks) sp.loop = false; // la sortie s'éteint
    });
    const wave = 0.035, start = 0.62;
    let end = start;
    for (const [eid, { t, s: sc }] of game.rest) {
        if (eid === player || eid === game.eye) continue;
        const t0 = start + Math.hypot(t[0] - p[0], t[2] - p[2]) * wave;
        tl.add({ eid, t0, t1: t0 + 0.45, prop: "translation", from: t, to: [t[0], t[1] - 2.5, t[2]], ease: EASE.in });
        tl.add({ eid, t0, t1: t0 + 0.45, prop: "scale", from: sc, to: [0, 0, 0], ease: EASE.in });
        end = Math.max(end, t0 + 0.45);
    }
    const cam = game.world.storage(Camera).size, size = viewSize(game.state);
    tl.track(start, end, size, size * 0.85, EASE.inOut, (v) => cam.set(game.camera, v));
    tl.cue(end + 0.15, () => { if (ui.mode === "play" || ui.mode === "pause") ui.show("win"); });
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

// Les pièces suivent leur bloc : même déplacement, même échelle (un bloc qui rétrécit les emporte)
function followParts(): void {
    const T = game.world.storage(Transform), tr = T.translation, sc = T.scale;
    for (const p of game.parts) {
        const k = sc.x.get(p.parent) / p.base;
        tr.set(p.eid, tr.x.get(p.parent) + p.off[0] * k, tr.y.get(p.parent) + p.off[1] * k, tr.z.get(p.parent) + p.off[2] * k);
        sc.set(p.eid, p.s[0] * k, p.s[1] * k, p.s[2] * k);
    }
}

// Le liseré de la sortie respire doucement
function pulseExit(): void {
    const k = 0.7 + 0.3 * Math.sin(game.clock * 2.6), e = MAT_OPTS.exitRing!.emissive!;
    game.world.resource(Materials).update(game.mats.exitRing, { emissive: [e[0] * k, e[1] * k, e[2] * k] });
}

// Taille de la vue orthographique pour que tout le niveau tienne à l'écran
const viewSize = (s: State) => Math.max(s.w * 0.75, s.h) + 2;

export const PuzzlePlugin: Plugin = {
    name: "Puzzle",
    // MeshPlugin doit être initialisé avant nous : on crée la boule avec Meshes.add
    dependencies: [MeshPlugin, BloomPlugin],
    initialize(world) {
        game.world = world;
        game.mats = Object.fromEntries(
            Object.entries(COLORS).map(([name, baseColor]) => [
                name,
                world.resource(Materials).add(StandardMaterial({ baseColor, perceptualRoughness: 0.6, ...MAT_OPTS[name as ColorName] })),
            ]),
        ) as Record<ColorName, MaterialHandle>;
        game.ball = world.resource(Meshes).add({ name: "boule", ...sphere(0.5, 24, 12) });
        game.wedge = world.resource(Meshes).add({ name: "coin", ...wedge() });
        game.bevel = world.resource(Meshes).add({ name: "bloc biseauté", ...bevelBox() });

        // couleurs et intensités : réglées par monde dans applyTheme
        const sun = (game.sun = world.create());
        world.add(sun, Transform, { rotation: lookAtRotation(0, 0, 0, 0.4, -2, -0.8) });
        world.add(sun, DirectionalLight, { color: 0xffe8cc, illuminance: 5000, shadowMapsEnabled: 1 });

        game.camera = world.create();
        world.add(game.camera, StandardRenderer);

        // vue plongeante (~70°) : les murs du bas masquent peu les cases derrière eux
        const eye: V3 = [0, 30, 11];
        world.add(game.camera, Camera, { clearColor: 0x191816, mode: CameraMode.Orthographic, near: -1000, far: 1000, size: 10 });
        world.add(game.camera, Transform, { translation: eye, rotation: lookAtRotation(...eye, 0, 0, 0) });
        // halo léger autour de ce qui brille (sortie, étincelles)
        world.add(game.camera, Bloom, { intensity: 0.12 });
        const h = /^#niveau-(\d+)$/.exec(location.hash);
        startLevel(h ? +h[1] - 1 : progress.last); // règle la taille de la vue et construit la scène
        bindInput(document.querySelector("canvas") as HTMLCanvasElement);

        ui.init({
            play: (i) => { finishAnim(); startLevel(i); },
            current: () => game.index,
            moves: () => game.history.length,
            // retour au titre après une victoire : on affiche le niveau suivant derrière le menu
            title: () => { if (game.won) { finishAnim(); startLevel(Math.min(game.index + 1, LEVELS.length - 1)); } },
        });
    },
    systems: [
        {
            name: "Puzzle/Play",
            update(world: World) {
                // pendant la sortie de niveau, plus aucune commande
                if (ui.mode !== "play" || (game.won && game.anim)) game.queue = [];
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
                game.clock += world.time.realDeltaTime;
                followParts();
                followGlue(world.time.realDeltaTime);
                followEye();
                updateSparks(world.time.realDeltaTime);
                pulseExit();
            },
        },
    ],
};
