// Product content shown by the kiosk. Swap this file to demo a different product.
// Bracketed text ([Brand], [X] h, …) is placeholder copy for the exhibitor to fill in.

import type { ModelGeometry } from "./model3d";

export const PRODUCT = {
  name: "ORBIT EARBUDS",
  brand: "[BRAND]",
  booth: "BOOTH [000]",
  kiosk: "KIOSK 1",
};

export type PartId = "shell" | "tip" | "driver" | "battery" | "board" | "mic";

/** The exploded earbud. Coordinates are in the model's own 520-unit-wide space. */
export const MODEL: ModelGeometry<PartId> = {
  vbw: 520,
  zm: 50,
  parts: [
    { id: "shell", d: "M150,95 Q200,68 252,88 Q300,112 296,164 Q292,200 262,214 L262,318 Q262,340 242,340 Q222,340 222,318 L222,214 Q172,210 150,192 Q140,150 150,95 Z", hd: 46, k: 0.45, o: [222, 150], tp: 80 },
    { id: "tip", d: "M150,108 Q96,112 92,150 Q96,188 150,192 Q160,150 150,108 Z", hd: 34, k: 0.55, o: [125, 150], tp: 112, tone: "soft" },
    { id: "driver", d: "M156,150 A40,40 0 1,0 236,150 A40,40 0 1,0 156,150 Z", hd: 24, k: 0.15, o: [196, 150], tp: 112, tone: "metal" },
    { id: "battery", d: "M236,150 A26,26 0 1,0 288,150 A26,26 0 1,0 236,150 Z", hd: 18, k: 0.2, o: [262, 150], tp: 126, tone: "metal" },
    { id: "board", d: "M228,214 L256,214 L256,300 L228,300 Z", hd: 9, k: 0, o: [242, 257], tone: "metal" },
    { id: "mic", d: "M224,318 L260,318 L260,330 Q260,342 242,342 Q224,342 224,330 Z", hd: 20, k: 0.3, o: [242, 330], tone: "metal" },
  ],
  // Where each part moves when the earbud is fully exploded.
  off: { shell: [0, 0], tip: [-110, 0], driver: [-30, -150], battery: [110, -110], board: [110, 20], mic: [0, 70] },
};

export type TopicRow = { a: string; b: string; part?: PartId };
export type Topic = {
  id: string;
  n: string;
  label: string; // shown on the topic button
  short: string; // how staff and the visitor see it summarised ("How it works")
  title: string;
  explode: number; // 0 assembled → 1 fully exploded
  highlight: PartId[];
  rows: TopicRow[];
};

// The general questions the kiosk answers, so staff can spend their time on the in-depth ones.
// Visitors pick any topic in any order.
export const TOPICS: Topic[] = [
  {
    id: "what", n: "01", label: "WHAT IT IS", short: "What it is",
    title: "Wireless earbuds that tune out the room.", explode: 0.12, highlight: [],
    rows: [
      { a: "True-wireless, with adaptive noise cancelling", b: "" },
      { a: "Built for all-day calls and music", b: "" },
      { a: "Pairs with phone, laptop and watch", b: "" },
    ],
  },
  {
    id: "how", n: "02", label: "HOW IT WORKS", short: "How it works",
    title: "Six parts, one job each.", explode: 1, highlight: [],
    rows: [
      { a: "Ear tip", b: "Seals the sound in", part: "tip" },
      { a: "Driver", b: "Makes the sound · [XX] mm", part: "driver" },
      { a: "Battery", b: "[X] h per charge", part: "battery" },
      { a: "Chip board", b: "Runs the noise cancelling", part: "board" },
      { a: "Mic array", b: "Picks out your voice", part: "mic" },
    ],
  },
  {
    id: "different", n: "03", label: "WHAT’S DIFFERENT", short: "What’s different",
    title: "Why teams choose it over [competitor].", explode: 0.7, highlight: ["board", "mic"],
    rows: [
      { a: "[Differentiator 1]", b: "e.g. noise cancelling that adapts in real time" },
      { a: "[Differentiator 2]", b: "e.g. [X]-hour battery life" },
      { a: "[Differentiator 3]", b: "e.g. [X]-year warranty" },
    ],
  },
  {
    id: "uses", n: "04", label: "WHERE IT’S USED", short: "Where it’s used",
    title: "Made for the in-between moments.", explode: 0.12, highlight: [],
    rows: [
      { a: "Commuting", b: "Blocks out train and street noise" },
      { a: "Calls & hybrid work", b: "Clear voice pickup" },
      { a: "Workouts", b: "Sweat resistant · [IPXX]" },
      { a: "Travel", b: "[X] h with the case" },
    ],
  },
  {
    id: "specs", n: "05", label: "SPECS", short: "Specs",
    title: "Specs & compatibility.", explode: 0.4, highlight: ["battery"],
    rows: [
      { a: "Battery", b: "[X] h · [X] h with case" },
      { a: "Bluetooth", b: "[5.x] · multipoint" },
      { a: "Water resistance", b: "[IPXX]" },
      { a: "Works with", b: "iOS · Android · Windows [confirm]" },
      { a: "Weight", b: "[X] g per bud" },
    ],
  },
];

// Staff shown when a visitor asks for a team member (placeholders for the exhibitor to fill in).
export const STAFF = [
  { initials: "[AB]", name: "[Staff name]" },
  { initials: "[CD]", name: "[Teammate name]" },
];
export const STAFF_ETA = "[X] MIN";
