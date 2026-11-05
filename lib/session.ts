// What one visitor did at the kiosk. Shared with staff when they ask for a team member, and
// included with the brochure when they leave their details. Cleared when they walk away.

import { TOPICS } from "./product";

export type LeadMethod = "badge" | "phone" | "email";

export type Session = {
  start: number; // ms timestamp when the visitor started interacting
  time: Record<string, number>; // ms spent on each topic
  picked: string[]; // topics opened, in order
  pricing: boolean; // wants a pricing follow-up
  email: string;
  company: string;
  sent: LeadMethod | null; // brochure requested via
  staffAsked: number | null; // when they asked for a team member
  staff: number; // which team member is coming (index into STAFF)
  staffAccepted: boolean;
};

export const newSession = (): Session => ({
  start: 0,
  time: {},
  picked: [],
  pricing: true,
  email: "",
  company: "",
  sent: null,
  staffAsked: null,
  staff: 0,
  staffAccepted: false,
});

// A topic counts as explored once it was opened on purpose or read for a few seconds.
const READ_MS = 3000;
export const exploredTopics = (s: Session) =>
  TOPICS.filter((t) => s.picked.includes(t.id) || (s.time[t.id] ?? 0) >= READ_MS).sort(
    (a, b) => order(s, a.id) - order(s, b.id),
  );
const order = (s: Session, id: string) => {
  const i = s.picked.indexOf(id);
  return i < 0 ? 99 : i;
};

export const longestTopic = (s: Session) => {
  let best: (typeof TOPICS)[number] | null = null;
  for (const t of TOPICS) if ((s.time[t.id] ?? 0) >= READ_MS && (!best || s.time[t.id] > s.time[best.id])) best = t;
  return best;
};

export const minutesAt = (s: Session, now: number) => {
  if (!s.start) return "—";
  const m = Math.round((now - s.start) / 60000);
  return m < 1 ? "Under 1 min" : `${m} min`;
};

// Leads are kept on this machine for the prototype (a real booth would send them to the CRM).
const LEADS_KEY = "playform.leads";
export function saveLead(s: Session, method: LeadMethod) {
  try {
    const leads = JSON.parse(localStorage.getItem(LEADS_KEY) ?? "[]");
    leads.push({
      at: new Date().toISOString(),
      method,
      email: method === "email" ? s.email : null,
      company: s.company || null,
      pricing: s.pricing,
      explored: exploredTopics(s).map((t) => t.short),
    });
    localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
  } catch {
    // Storage blocked: the confirmation still shows; nothing to recover for a prototype.
  }
}
