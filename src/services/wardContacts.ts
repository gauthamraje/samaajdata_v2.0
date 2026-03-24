/**
 * Ward-level responsibility contacts — pilot overrides in public/data/ward_contacts.json.
 * Keys are ward ids (e.g. WARD_1). Merge in UI with base WardRecord from wards.json.
 */

export interface WardContactRecord {
  corporation?: string;
  zone_name?: string;
  zone_office_phone?: string;
  ward_office_address?: string;
  ward_office_phone?: string;
  ward_office_email?: string;
  assistant_engineer_name?: string;
  assistant_engineer_phone?: string;
  ward_page_url?: string;
  bescom_circle?: string;
  bwssb_sub_division?: string;
  /** Shown as disclaimer under block */
  data_note?: string;
}

const WARD_CONTACTS_URL = "/data/ward_contacts.json";

export async function fetchWardContacts(): Promise<Record<string, WardContactRecord>> {
  const res = await fetch(WARD_CONTACTS_URL);
  if (!res.ok) return {};
  const data: unknown = await res.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, WardContactRecord>;
}
