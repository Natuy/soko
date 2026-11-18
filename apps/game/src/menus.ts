// Menus du jeu (écran titre, choix du niveau, pause, victoire, commandes, options)
// et progression du joueur. Simple surcouche HTML au-dessus du canvas.
import { LEVELS, WORLDS } from "../../../packages/core/src/index.js";

export type Mode = "title" | "levels" | "pause" | "win" | "help" | "options" | "play";
export type AnimSpeed = "normale" | "rapide" | "aucune";

// ---- Progression (enregistrée par nom de niveau, comme dans le lab) ----
const load = <T>(key: string, fallback: T): T => {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
        return fallback;
    }
};
const save = (key: string, v: unknown) => {
    try {
        localStorage.setItem(key, JSON.stringify(v));
    } catch {}
};

export const progress = {
    solved: new Set<string>(load<string[]>("pz-solved-names", [])),
    best: load<Record<string, number>>("pz-game-best", {}),
    last: load<number>("pz-game-last", 0),
    speed: load<AnimSpeed>("pz-game-anim", "normale"),
    win(name: string, moves: number) {
        this.solved.add(name);
        save("pz-solved-names", [...this.solved]);
        if (!(this.best[name] <= moves)) {
            this.best[name] = moves;
            save("pz-game-best", this.best);
        }
    },
    setLast(i: number) {
        this.last = i;
        save("pz-game-last", i);
    },
    setSpeed(s: AnimSpeed) {
        this.speed = s;
        save("pz-game-anim", s);
    },
};

// ---- Ce que les menus demandent au jeu ----
export interface MenuActions {
    play(index: number): void; // lance (ou relance) un niveau
    current(): number; // niveau affiché
    moves(): number; // coups joués dans le niveau en cours
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const MENUS: Mode[] = ["title", "levels", "pause", "win", "help", "options"];

export const ui = {
    mode: "title" as Mode,
    back: [] as Mode[], // d'où l'on vient, pour « Retour » et Échap
    actions: null as unknown as MenuActions,

    init(actions: MenuActions) {
        this.actions = actions;
        document.querySelectorAll<HTMLElement>("[data-go]").forEach((b) =>
            b.addEventListener("click", () => this.go(b.dataset.go!)),
        );
        document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
            b.addEventListener("click", () => {
                progress.setSpeed(b.dataset.speed as AnimSpeed);
                this.renderOptions();
            }),
        );
        $("hint-btn").addEventListener("click", () => {
            $("hint").hidden = false;
            $("hint-btn").hidden = true;
        });
        window.addEventListener("keydown", (e) => this.key(e), { capture: true });
        this.show("title");
    },

    // Boutons : data-go="play", "resume", "levels", "pause", "next", "restart", "title", "help", "options", "back"
    go(what: string) {
        const a = this.actions;
        switch (what) {
            case "continue": return this.startLevel(a.current());
            case "next": return this.startLevel(Math.min(a.current() + 1, LEVELS.length - 1));
            case "restart": return this.startLevel(a.current());
            case "resume": return this.show("play");
            case "back": return this.show(this.back.pop() ?? "title", false);
            case "levels": case "help": case "options": case "pause": case "title":
                return this.show(what as Mode, what !== "title" && what !== "pause");
        }
    },

    startLevel(i: number) {
        this.back = [];
        this.actions.play(i);
        this.show("play");
    },

    // Affiche un menu (ou le jeu). remember : empile le menu courant pour « Retour ».
    show(mode: Mode, remember = false) {
        if (remember && this.mode !== mode && this.mode !== "play") this.back.push(this.mode);
        if (mode === "play" || mode === "title") this.back = [];
        this.mode = mode;
        for (const m of MENUS) $(`m-${m}`).hidden = m !== mode;
        $("ui").classList.toggle("on", mode !== "play");
        $("hud").classList.toggle("dim", mode === "title" || mode === "levels");
        if (mode === "title") this.renderTitle();
        if (mode === "levels") this.renderLevels();
        if (mode === "pause") this.renderPause();
        if (mode === "options") this.renderOptions();
        if (mode === "win") this.renderWin();
        // focus sur le premier bouton : le menu se joue aussi au clavier
        const first = $(`m-${mode}`)?.querySelector<HTMLElement>(mode === "levels" ? ".lv.current, .lv" : "button:not([hidden])");
        if (mode !== "play") requestAnimationFrame(() => first?.focus());
        else (document.activeElement as HTMLElement | null)?.blur?.();
    },

    // Échap et flèches dans les menus. En jeu, Échap ouvre la pause.
    key(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.mode === "play") this.show("pause");
            else if (this.mode === "pause") this.show("play");
            else if (this.mode === "win") this.startLevel(Math.min(this.actions.current() + 1, LEVELS.length - 1));
            else if (this.mode !== "title") this.go("back");
            return;
        }
        if (this.mode === "play") return;
        e.stopImmediatePropagation(); // les touches du jeu sont coupées pendant un menu
        const dir = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const items = [...$(`m-${this.mode}`).querySelectorAll<HTMLElement>("button:not([hidden])")].filter((b) => b.offsetParent);
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + dir + items.length) % items.length]?.focus();
    },

    renderTitle() {
        const i = this.actions.current(), started = progress.solved.size > 0 || progress.last > 0;
        $("continue").innerHTML = started ? `Continuer <small>${i + 1}. ${LEVELS[i].name}</small>` : "Jouer";
        $("title-count").textContent = `${progress.solved.size} / ${LEVELS.length} niveaux réussis`;
    },

    renderLevels() {
        const list = $("level-list");
        list.innerHTML = "";
        let index = 0;
        const cur = this.actions.current();
        for (const w of WORLDS) {
            const [title, theme] = w.world.split(" · ");
            const done = w.levels.filter((l) => progress.solved.has(l.name)).length;
            const sec = document.createElement("section");
            sec.innerHTML = `<h3>${title} <small>${theme ?? ""}</small><span>${done} / ${w.levels.length}</span></h3><div class="grid"></div>`;
            const grid = sec.querySelector(".grid")!;
            for (const l of w.levels) {
                const i = index++, b = document.createElement("button");
                const solved = progress.solved.has(l.name);
                b.className = "lv" + (solved ? " solved" : "") + (i === cur ? " current" : "");
                b.title = l.name;
                b.innerHTML = `<b>${i + 1}</b><span>${l.name}</span>${solved ? `<i>✓ ${progress.best[l.name] ?? ""}</i>` : ""}`;
                b.addEventListener("click", () => this.startLevel(i));
                grid.appendChild(b);
            }
            list.appendChild(sec);
        }
        requestAnimationFrame(() => list.querySelector(".current")?.scrollIntoView({ block: "center" }));
    },

    renderPause() {
        const l = LEVELS[this.actions.current()];
        $("pause-level").textContent = `${this.actions.current() + 1}. ${l.name}`;
        $("pause-moves").textContent = `${this.actions.moves()} coups joués`;
        $("hint").textContent = l.hint ?? "Pas d'indice pour ce niveau.";
    },

    renderWin() {
        const i = this.actions.current(), l = LEVELS[i], n = this.actions.moves(), par = l.solution?.length;
        $("win-level").textContent = `${i + 1}. ${l.name}`;
        $("win-moves").innerHTML = `En <b>${n}</b> coup${n > 1 ? "s" : ""}` +
            (par ? (n <= par ? ` — aussi bien que la solution de référence !` : ` · référence : ${par}`) : "");
        const last = i === LEVELS.length - 1;
        $("win-next").hidden = last;
        $("win-end").hidden = !last;
    },

    renderOptions() {
        document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
            b.classList.toggle("on", b.dataset.speed === progress.speed),
        );
    },

    // Nouveau niveau : l'indice redevient caché
    resetHint() {
        $("hint").hidden = true;
        $("hint-btn").hidden = false;
    },
};
