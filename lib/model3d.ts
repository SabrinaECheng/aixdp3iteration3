// A product drawn as an exploded, sliced 3D model. Each part is extruded into Z by
// stacking 2D slices that shrink towards the part's half-depth, which reads as a
// soft 3D volume under CSS perspective.

type Tone = "pearl" | "soft" | "metal";

export type ModelPart<Id extends string> = {
  id: Id;
  d: string; // outline (SVG path, may have holes: drawn with fill-rule evenodd)
  hd: number; // half-depth in Z
  k: number; // how much slices shrink towards the edges
  o: [number, number]; // scale origin
  tp?: number; // top of the sheen highlight, if any
  tone?: Tone;
  zc?: number; // depth centre
  ze?: number; // extra depth when exploded
};

export type ModelGeometry<Id extends string> = {
  vbw: number; // width of the model's coordinate space
  zm: number; // depth extent
  parts: ModelPart<Id>[];
  off: Record<Id, [number, number]>; // where each part moves when fully exploded
};

export type ModelPath = { key: string; d: string; tf: string; fill: string; stroke: string; sw: number; op: number };
export type ModelSlice = { z: string; paths: ModelPath[] };

const TONES: Record<Tone, [string, string]> = {
  pearl: ["#F8F3F1", "#A3949F"],
  soft: ["#E6E3EE", "#8F889E"],
  metal: ["#C7CBD6", "#555A6B"],
};

const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const mix = (a: string, b: string, t: number) =>
  "#" +
  hx(a)
    .map((v, j) => Math.round(v + (hx(b)[j] - v) * t).toString(16).padStart(2, "0"))
    .join("");

export function buildModel<Id extends string>(o: {
  geo: ModelGeometry<Id>;
  w: number; // rendered width
  accent: string;
  explode: number; // 0 assembled → 1 exploded
  highlight: readonly Id[];
}): ModelSlice[] {
  const G = o.geo;
  const k = o.w / G.vbw;
  const N = 22;
  const zm = G.zm;
  const step = (2 * zm) / (N - 1);
  const e = o.explode;
  const slices: ModelSlice[] = [];

  for (let i = 0; i < N; i++) {
    const z = -zm + step * i;
    const paths: ModelPath[] = [];
    for (const p of G.parts) {
      const dz = z - ((p.zc ?? 0) + (p.ze ?? 0) * e);
      if (Math.abs(dz) > p.hd) continue;
      const front = dz + step > p.hd;
      const on = o.highlight.includes(p.id);
      const s = 1 - p.k * Math.pow(dz / p.hd, 2);
      const [ox, oy] = G.off[p.id] ?? [0, 0];
      const tf = `translate(${(ox * e).toFixed(1)},${(oy * e).toFixed(1)}) translate(${p.o[0]},${p.o[1]}) scale(${s.toFixed(3)}) translate(${-p.o[0]},${-p.o[1]})`;
      const [light, dark] = TONES[p.tone ?? "pearl"];
      const c = front ? light : mix(dark, light, 0.25 + 0.6 * ((z + zm) / (2 * zm)));
      let n = 0;
      const push = (x: Omit<ModelPath, "key" | "d" | "tf"> & { tf?: string }) => paths.push({ d: p.d, tf, ...x, key: `${p.id}-${n++}` });
      if (on && front) push({ fill: "none", stroke: o.accent, sw: 9, op: 0.4 });
      push({ fill: c, stroke: front ? (on ? o.accent : mix(light, dark, 0.35)) : c, sw: front ? (on ? 2.5 : 1.2) : 2.4, op: 1 });
      if (front && p.tp != null) {
        const tp = p.tp;
        push({
          fill: "#FFFFFF",
          stroke: "none",
          sw: 0,
          op: 0.35,
          tf: `${tf} translate(${p.o[0]},${tp}) scale(0.78,0.42) translate(${-p.o[0]},${-tp})`,
        });
      }
    }
    slices.push({ z: (z * k).toFixed(1), paths });
  }
  return slices;
}
