/**
 * Civic commitments / "promise lite" — curated JSON for pilot transparency.
 * Edit public/data/promises.json; do not invent real commitments without a source.
 */

export type CivicPromiseStatus = "reported" | "in_progress" | "completed" | "unclear";

export interface CivicPromiseRecord {
  id: string;
  title: string;
  actor: string;
  /** null = city-wide or non-ward-specific */
  ward_id: string | null;
  jurisdiction?: string;
  committed_at: string;
  status: CivicPromiseStatus;
  summary: string;
  source_url: string;
  source_label: string;
}

const PROMISES_URL = "/data/promises.json";

export async function fetchPromises(): Promise<CivicPromiseRecord[]> {
  const res = await fetch(PROMISES_URL);
  if (!res.ok) return [];
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [];
  return data as CivicPromiseRecord[];
}

export function promisesForWard(
  promises: CivicPromiseRecord[],
  wardId: string | null
): CivicPromiseRecord[] {
  if (!wardId) return [];
  return promises.filter((p) => p.ward_id === null || p.ward_id === wardId);
}
