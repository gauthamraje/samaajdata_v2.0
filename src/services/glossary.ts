/**
 * Glossary for jargon/acronyms so the UI can explain terms without AI.
 * Keep entries short, actionable, and citizen-friendly.
 */

import type { Category } from "./wards";

export type GlossaryEntry = {
  term: string;
  plainTitle: string;
  explanation: string; // 1-2 lines
  howToStart?: string[]; // optional 2-4 steps
  category?: Category;
  aliases?: string[];
};

const GLOSSARY: GlossaryEntry[] = [
  {
    term: "Bengawalk",
    plainTitle: "Neighborhood Walkability Drive",
    explanation:
      "A citizen-led street walk to spot footpath, crossing, and streetlight issues and coordinate quick fixes with the ward office.",
    howToStart: [
      "Pick a 30–45 min walking route and invite 8–12 neighbors.",
      "Log issues (photo + location) and group by urgency.",
      "Share the list with the ward office and follow up weekly until closure.",
    ],
    category: "Safety",
    aliases: ["benga walk", "walkability drive", "street audit walk"],
  },
  {
    term: "KYC",
    plainTitle: "Know Your Street (DIY Street Audit)",
    explanation:
      "A simple citizen audit to document local civic issues (water/roads/sanitation) and present a clear list to authorities.",
    howToStart: ["Form a small team.", "Use a checklist.", "Collect evidence.", "Share results and track closures."],
    category: "Safety",
    aliases: ["know your street", "street audit", "kyc - know your street"],
  },
  {
    term: "LAMP",
    plainTitle: "Streetlight Brightness Mapping",
    explanation:
      "Measure streetlight brightness and map dark spots so repairs can be prioritized to reduce accidents and improve safety.",
    category: "Safety",
    aliases: ["luminosity map", "streetlight mapping"],
  },
  {
    term: "CCC",
    plainTitle: "Fix a Blackspot (Call–Clean–Collaborate)",
    explanation:
      "A repeatable cleanup method to fix a chronic dumping spot: get pickup scheduled, clean safely as a group, then maintain with RWAs/NGOs.",
    category: "Waste",
    aliases: ["call clean collaborate", "blackspot formula"],
  },
  {
    term: "DISS",
    plainTitle: "Discover–Investigate–Solve–Share (School Civic Project)",
    explanation:
      "A student-friendly method to find a problem, understand root cause, implement a fix, and share learnings to scale it.",
    category: "Health",
    aliases: ["discover investigate solve share"],
  },
  {
    term: "BMLTA",
    plainTitle: "Unified City Transport Authority (Campaign)",
    explanation:
      "A mobility governance push for one coordinating authority so buses/metro/traffic planning work together instead of in silos.",
    category: "Safety",
    aliases: ["bmlta campaign", "transport authority campaign"],
  },
];

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function matchGlossary(query: string): GlossaryEntry | null {
  const q = normalize(query);
  if (!q || q.length < 2) return null;
  for (const entry of GLOSSARY) {
    const candidates = [entry.term, ...(entry.aliases ?? [])].map(normalize);
    if (candidates.some((c) => c === q || q.includes(c) || c.includes(q))) return entry;
  }
  return null;
}

export function formatGlossaryReply(entry: GlossaryEntry): string {
  return `${entry.term}: ${entry.plainTitle}. ${entry.explanation}`;
}

