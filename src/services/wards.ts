/**
 * Ward data service: fetch wards from local JSON or Frappe REST API.
 * Components consume an array of ward objects with consistent IDs and field names
 * so the source can be swapped without changing UI code.
 */

export type Category = "Waste" | "Water" | "Safety" | "Health";

/** Single issue in a ward (consistent with Frappe child table or JSON) */
export interface WardIssueRecord {
  description: string;
  status: "Open" | "In Progress" | "Solved";
}

/** Proven solution (consistent field names for API/Frappe) */
export interface ProvenSolutionRecord {
  issue: string;
  fix_description: string;
  contributor_name: string;
  category: Category;
}

/** Local champion (consistent field names for API/Frappe) */
export interface LocalChampionRecord {
  name: string;
  expertise: string;
  contact: string;
  categories: Category[];
}

/**
 * Ward resource shape. Use these exact field names so Frappe REST
 * (e.g. GET /api/resource/Ward) can be mapped to this shape.
 */
export interface WardRecord {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  councilor_name: string;
  councilor_contact: string;
  description: string;
  status: string;
  issues: WardIssueRecord[];
  proven_solutions: ProvenSolutionRecord[];
  local_champions: LocalChampionRecord[];
}

/** Sample data URL (public/api/wards.json). Replace with Frappe API when ready. */
const WARDS_JSON_URL = "/api/wards.json";

/**
 * Fetches ward list. Returns array of objects with consistent IDs and field names.
 * Currently uses local sample data; later swap to Frappe (e.g. /api/resource/Ward)
 * and map with mapFrappeWardToRecord().
 */
export async function fetchWards(): Promise<WardRecord[]> {
  const res = await fetch(WARDS_JSON_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch wards: ${res.status} ${res.statusText}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Wards response must be an array of ward objects.");
  }
  return data as WardRecord[];
}

/**
 * Map a Frappe document to WardRecord. Use when switching to Frappe REST:
 *
 *   const res = await fetch('/api/resource/Ward');
 *   const { data } = await res.json();
 *   return data.map(mapFrappeWardToRecord);
 *
 * Adjust property names (e.g. doc.ward_name -> name) to match your Doctype fields.
 */
export function mapFrappeWardToRecord(doc: Record<string, unknown>): WardRecord {
  return {
    id: String(doc.name ?? doc.id ?? ""),
    name: String(doc.ward_name ?? doc.name ?? ""),
    latitude: Number(doc.latitude ?? 0),
    longitude: Number(doc.longitude ?? 0),
    councilor_name: String(doc.councilor_name ?? ""),
    councilor_contact: String(doc.councilor_contact ?? ""),
    description: String(doc.description ?? ""),
    status: String(doc.status ?? "Active"),
    issues: (doc.issues as WardIssueRecord[]) ?? [],
    proven_solutions: (doc.proven_solutions as ProvenSolutionRecord[]) ?? [],
    local_champions: (doc.local_champions as LocalChampionRecord[]) ?? [],
  };
}
