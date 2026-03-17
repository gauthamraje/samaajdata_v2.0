/**
 * Actions taken (from CSV import). Used for the map layer.
 */

export interface ActionRecord {
  id: string;
  title: string;
  type: string;
  category: string;
  description: string;
  location: string | null;
  creation: string | null;
  latitude: number;
  longitude: number;
  ward_id?: string;
  place_name?: string | null;
}

const ACTIONS_JSON_URL = "/data/actions.json";

export async function fetchActions(): Promise<ActionRecord[]> {
  const res = await fetch(ACTIONS_JSON_URL);
  if (!res.ok) {
    return [];
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as ActionRecord[]) : [];
}
