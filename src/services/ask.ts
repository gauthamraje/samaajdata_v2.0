/**
 * Ask me anything: match user query against wards and actions (no OpenAI).
 * Returns the best match so the right panel and map can show that location.
 */

import type { WardRecord } from "./wards";
import type { ActionRecord } from "./actions";

export type AskResult =
  | { kind: "ward"; ward: WardRecord; reply: string; lat: number; lng: number }
  | { kind: "action"; action: ActionRecord; ward: WardRecord | null; reply: string; lat: number; lng: number }
  | { kind: "none"; reply: string };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function scoreMatch(text: string, query: string): number {
  if (!query.length) return 0;
  const t = normalize(text);
  const q = normalize(query);
  if (t.includes(q)) return 10;
  const qWords = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const w of qWords) {
    if (w.length < 2) continue;
    if (t.includes(w)) score += 2;
  }
  return score;
}

export function ask(
  query: string,
  wards: WardRecord[],
  actions: ActionRecord[],
  wardDetailsMap: Record<string, WardRecord> | null
): AskResult {
  const q = normalize(query);
  if (!q || q.length < 2) {
    return { kind: "none", reply: "Type a question (e.g. ward name, place, waste, water, a councilor or issue)." };
  }

  // Match wards by name, councilor, description, issues, champions
  let bestWard: WardRecord | null = null;
  let bestWardScore = 0;

  for (const ward of wards) {
    let s = scoreMatch(ward.name, query);
    s += scoreMatch(ward.councilor_name, query);
    s += scoreMatch(ward.description, query);
    for (const issue of ward.issues || []) {
      s += scoreMatch(issue.description, query);
    }
    for (const sol of ward.proven_solutions || []) {
      s += scoreMatch(sol.issue, query) + scoreMatch(sol.fix_description, query);
    }
    for (const ch of ward.local_champions || []) {
      s += scoreMatch(ch.name, query) + scoreMatch(ch.expertise, query);
    }
    if (s > bestWardScore) {
      bestWardScore = s;
      bestWard = ward;
    }
  }

  // Match actions by title, category, description, place
  let bestAction: ActionRecord | null = null;
  let bestActionScore = 0;

  for (const action of actions) {
    let s = scoreMatch(action.title, query);
    s += scoreMatch(action.category, query);
    s += scoreMatch(action.description || "", query);
    s += scoreMatch(action.place_name || "", query);
    s += scoreMatch(action.location || "", query);
    if (s > bestActionScore) {
      bestActionScore = s;
      bestAction = action;
    }
  }

  // Prefer ward if query looks like a place/ward name; else prefer stronger match
  if (bestWard && bestWardScore >= 2) {
    const wardLat = typeof bestWard.latitude === "number" ? bestWard.latitude : 20.59;
    const wardLng = typeof bestWard.longitude === "number" ? bestWard.longitude : 78.96;
    const reply =
      bestWardScore >= 6
        ? `Showing ${bestWard.name}. Check the panel for ward details, issues, solutions, and citizens.`
        : `Best match: ${bestWard.name}. Details on the right.`;
    return { kind: "ward", ward: bestWard, reply, lat: wardLat, lng: wardLng };
  }

  if (bestAction && bestActionScore >= 2) {
    const lat = typeof bestAction.latitude === "number" ? bestAction.latitude : 20.59;
    const lng = typeof bestAction.longitude === "number" ? bestAction.longitude : 78.96;
    const ward =
      bestAction.ward_id && wardDetailsMap?.[bestAction.ward_id]
        ? wardDetailsMap[bestAction.ward_id]
        : null;
    const place = bestAction.place_name ? ` in ${bestAction.place_name}` : "";
    const reply = `Found: "${bestAction.title}"${place}. Opening details on the right and moving the map.`;
    return { kind: "action", action: bestAction, ward, reply, lat, lng };
  }

  if (bestWard && bestWardScore >= 1) {
    const wardLat = typeof bestWard.latitude === "number" ? bestWard.latitude : 20.59;
    const wardLng = typeof bestWard.longitude === "number" ? bestWard.longitude : 78.96;
    return {
      kind: "ward",
      ward: bestWard,
      reply: `Closest match: ${bestWard.name}. See panel for details.`,
      lat: wardLat,
      lng: wardLng,
    };
  }

  return {
    kind: "none",
    reply: "No matching ward or action found. Try a ward name (e.g. Central, East), place name, or topic (waste, water, safety).",
  };
}
