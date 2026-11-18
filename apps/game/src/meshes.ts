// Géométries du jeu, au format des meshes Shallot : 8 flottants par sommet
// (px, py, pz, u, nx, ny, nz, v), faces planes, triangles tournés vers l'extérieur.

type P3 = [number, number, number];

// Assemble des faces planes (polygones convexes). Chaque triangle est orienté pour que sa
// normale pointe à l'opposé du centre de l'objet : l'ordre des sommets n'a pas d'importance.
function build(faces: P3[][], center: P3 = [0, 0, 0]): { vertices: Float32Array; indices: Uint32Array } {
    const v: number[] = [], idx: number[] = [];
    const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let face of faces) {
        let n = cross(sub(face[1], face[0]), sub(face[2], face[0]));
        const mid = face.reduce<P3>((m, p) => [m[0] + p[0] / face.length, m[1] + p[1] / face.length, m[2] + p[2] / face.length], [0, 0, 0]);
        if (dot(n, sub(mid, center)) < 0) { face = [...face].reverse(); n = n.map((x) => -x) as P3; }
        const len = Math.hypot(...n) || 1;
        n = n.map((x) => x / len) as P3;
        const base = v.length / 8;
        for (const p of face) v.push(p[0], p[1], p[2], p[0] + 0.5, n[0], n[1], n[2], p[2] + 0.5);
        for (let i = 1; i + 1 < face.length; i++) idx.push(base, base + i, base + i + 1);
    }
    return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
}

// Prisme droit : un polygone convexe du plan XZ extrudé sur la hauteur h (centré en y = 0)
export function prism(points: [number, number][], h = 1): { vertices: Float32Array; indices: Uint32Array } {
    const top = points.map(([x, z]) => [x, h / 2, z] as P3), bottom = points.map(([x, z]) => [x, -h / 2, z] as P3);
    const sides = points.map((_, i) => {
        const j = (i + 1) % points.length;
        return [bottom[i], bottom[j], top[j], top[i]];
    });
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length, cz = points.reduce((s, p) => s + p[1], 0) / points.length;
    return build([top, bottom, ...sides], [cx, 0, cz]);
}

// Demi-carré : un coin, dos plat et pointe vers +X (on le tourne selon sa direction)
export const wedge = () => prism([[-0.5, -0.5], [0.5, 0], [-0.5, 0.5]]);

// Bloc aux arêtes chanfreinées (octogone extrudé, dessus biseauté) : plus doux qu'un cube
export function bevelBox(c = 0.12): { vertices: Float32Array; indices: Uint32Array } {
    const ring = (r: number, y: number): P3[] => [
        [-r + c, y, -r], [r - c, y, -r], [r, y, -r + c], [r, y, r - c],
        [r - c, y, r], [-r + c, y, r], [-r, y, r - c], [-r, y, -r + c],
    ];
    const lo = ring(0.5, -0.5), mid = ring(0.5, 0.5 - c), hi = ring(0.5 - c, 0.5).map(([x, y, z]) => [x * 0.999, y, z * 0.999] as P3);
    const faces: P3[][] = [lo, hi];
    for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        faces.push([lo[i], lo[j], mid[j], mid[i]]);
        faces.push([mid[i], mid[j], hi[j], hi[i]]);
    }
    // dégénérés possibles (arêtes de longueur nulle) : on les retire
    return build(faces.filter((f) => new Set(f.map((p) => p.join())).size >= 3));
}
