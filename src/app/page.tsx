"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Phone,
  Lightbulb,
  MapPin,
  MapPinned,
  MessageCircle,
  Send,
  LocateFixed,
  ExternalLink,
  ShieldCheck,
  Info,
} from "lucide-react";
import { AboutModal } from "@/components/AboutModal";
import {
  fetchPromises,
  type CivicPromiseRecord,
} from "@/services/promises";
import {
  fetchWardContacts,
  type WardContactRecord,
} from "@/services/wardContacts";
import {
  fetchWards,
  type Category,
  type WardRecord,
  type WardIssueRecord,
  type ProvenSolutionRecord,
  type LocalChampionRecord,
} from "@/services/wards";
import { fetchActions, type ActionRecord } from "@/services/actions";
import {
  fetchForumSolutions,
  type ForumSolution,
} from "@/services/forumKb";
import { ask, type AskResult } from "@/services/ask";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";

/** Build synthetic ward detail when only an action is selected (no ward in map). */
function buildSyntheticDetail(
  action: ActionRecord,
  forumSolutions: ForumSolution[]
): WardRecord {
  const category = inferCategory(action.category);
  const forumForCategory = forumSolutions.filter(
    (f) =>
      f.title.toLowerCase().includes(category.toLowerCase()) ||
      f.description.toLowerCase().includes(category.toLowerCase())
  );
  const solutions: ProvenSolutionRecord[] = forumForCategory.slice(0, 2).map((f, i) => ({
    issue: f.title,
    fix_description: f.description,
    contributor_name: "Community / Knowledge Base",
    category,
  }));
  if (solutions.length === 0 && forumSolutions.length > 0) {
    solutions.push({
      issue: forumSolutions[0].title,
      fix_description: forumSolutions[0].description,
      contributor_name: "Community",
      category,
    });
  }
  return {
    id: action.ward_id || "synthetic",
    name: action.place_name || "Area",
    latitude: action.latitude ?? 20.59,
    longitude: action.longitude ?? 78.96,
    councilor_name: "Local Council Office",
    councilor_contact: "—",
    description: `Area around ${action.place_name || "this location"}. Data from citizen reports.`,
    status: "Active",
    issues: [
      { description: action.title, status: "In Progress" as const },
      { description: "Other local issues reported in this area.", status: "Open" as const },
    ],
    proven_solutions: solutions,
    local_champions: [
      { name: "Area Volunteer", expertise: "Local coordination", contact: "—", categories: [category] },
      { name: "Community Lead", expertise: action.category || "Civic issues", contact: "—", categories: [category] },
    ],
  };
}

function inferCategory(cat: string | undefined): Category {
  if (!cat) return "Waste";
  const c = cat.toLowerCase();
  if (c.includes("waste") || c.includes("solid")) return "Waste";
  if (c.includes("water") || c.includes("sanitation")) return "Water";
  if (c.includes("safety") || c.includes("street") || c.includes("traffic") || c.includes("road")) return "Safety";
  if (c.includes("health") || c.includes("civic")) return "Health";
  return "Waste";
}

function nearestWardFor(lat: number, lng: number, wards: WardRecord[]): WardRecord | null {
  if (wards.length === 0) return null;
  let best: WardRecord | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const w of wards) {
    if (typeof w.latitude !== "number" || typeof w.longitude !== "number") continue;
    const dLat = w.latitude - lat;
    const dLng = w.longitude - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) {
      bestDist = d;
      best = w;
    }
  }
  return best;
}

const WardMap = dynamic(() => import("@/components/WardMap"), {
  ssr: false,
  loading: () => (
    <div
      className="h-full w-full bg-slate-800"
      aria-hidden
    />
  ),
});

type WardId = string;

interface WardMeta {
  id: WardId;
  name: string;
}

export type SidebarMode = "area_brief" | "local_signals" | "solution_finder";
type LocalSignalsTab = "issues" | "open_data" | "citizens";
type CompareArea = {
  id: string;
  label: string;
  color: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};
type CompareMetric = {
  areaId: string;
  label: string;
  color: string;
  issues: number;
  openData: number;
  activeCitizens: number;
};

const SIDEBAR_MODES: { id: SidebarMode; label: string; helper: string }[] = [
  { id: "area_brief", label: "Local governance", helper: "Ward governance and local context." },
  { id: "local_signals", label: "Local data", helper: "Citizen reports, public records, and active citizens." },
  { id: "solution_finder", label: "Solutions", helper: "Practical solutions with trust signals." },
];

type LocationSuggestion = { display_name: string; lat: string; lon: string };

/** Unified solution item for display (ward or forum). */
type SolutionDisplay = { type: "ward"; sol: ProvenSolutionRecord } | { type: "forum"; sol: ForumSolution };

type VerificationLevel = "official_dataset" | "community_documented" | "knowledge_base";

type VerificationMeta = {
  level: VerificationLevel;
  headline: string;
  detail: string;
  sourceUrl?: string;
  sourceLabel?: string;
  lastUpdated: string;
};

function Sidebar({
  selectedWard,
  selectedAction,
  wardDetailsMap,
  forumSolutions,
  promises,
  wardContactsByWardId,
  loading,
  selectionType,
  forceView,
  forceCategory,
  actions,
  onPickSample,
  onSolutionsMapFilterChange,
  compareMode,
  compareAreas,
  compareMetrics,
  onExitCompareMode,
  onResetCompareAreas,
}: {
  selectedWard: WardMeta | null;
  selectedAction: ActionRecord | null;
  wardDetailsMap: Record<string, WardRecord> | null;
  forumSolutions: ForumSolution[];
  promises: CivicPromiseRecord[];
  wardContactsByWardId: Record<string, WardContactRecord> | null;
  loading: boolean;
  /** When user clicks a marker: 'action' → show Issues reported, 'ward' → show Ward details */
  selectionType: "ward" | "action" | null;
  /** Optional parent override for mode (e.g. Ask glossary → solution_finder). */
  forceView?: SidebarMode | null;
  /** Optional parent override for category filter (solutions/citizens). */
  forceCategory?: Category | "All" | null;
  actions: ActionRecord[];
  onPickSample: () => void;
  onSolutionsMapFilterChange: (category: Category | "All" | null) => void;
  compareMode: boolean;
  compareAreas: CompareArea[];
  compareMetrics: CompareMetric[];
  onExitCompareMode: () => void;
  onResetCompareAreas: () => void;
}) {
  const [mode, setMode] = useState<SidebarMode>("area_brief");
  const [signalsTab, setSignalsTab] = useState<LocalSignalsTab>("issues");
  const [activeCategory, setActiveCategory] = useState<Category | "All">("All");
  const [solutionsViewMode, setSolutionsViewMode] = useState<"text" | "map">("text");

  // Switch panel mode when user clicks a marker: action → local signals, ward → area brief
  useEffect(() => {
    if (selectionType === "action") {
      setMode("local_signals");
      setSignalsTab("issues");
    }
    if (selectionType === "ward") setMode("area_brief");
  }, [selectionType]);

  useEffect(() => {
    if (forceView) setMode(forceView);
  }, [forceView]);

  useEffect(() => {
    if (forceCategory) setActiveCategory(forceCategory);
  }, [forceCategory]);

  useEffect(() => {
    const filter =
      mode === "solution_finder" && solutionsViewMode === "map"
        ? activeCategory
        : null;
    onSolutionsMapFilterChange(filter);
  }, [mode, solutionsViewMode, activeCategory, onSolutionsMapFilterChange]);

  const categories: (Category | "All")[] = [
    "All",
    "Waste",
    "Water",
    "Safety",
    "Health",
  ];

  // Resolve display ward: from selection or from action's ward_id / synthetic
  const displayWard: WardMeta | null =
    selectedWard ||
    (selectedAction
      ? {
          id: selectedAction.ward_id || "synthetic",
          name: selectedAction.place_name || "Area",
        }
      : null);

  // Resolve detail: from ward map or synthetic when only action
  const baseDetail: WardRecord | null =
    displayWard && wardDetailsMap?.[displayWard.id]
      ? wardDetailsMap[displayWard.id]
      : selectedAction
        ? buildSyntheticDetail(selectedAction, forumSolutions)
        : null;

  // When viewing from an action: prepend action as first issue; ensure ≥2 issues
  const issuesForPanel: WardIssueRecord[] =
    baseDetail?.issues != null
      ? selectedAction
        ? [
            { description: selectedAction.title, status: "In Progress" as const },
            ...baseDetail.issues.filter((_, i) => i < 3),
          ].slice(0, 4)
        : baseDetail.issues
      : [];

  // Solutions: cluster logic — ward solutions + forum by category (action's or activeCategory), max 2
  const categoryForCluster = selectedAction
    ? inferCategory(selectedAction.category)
    : activeCategory === "All"
      ? null
      : activeCategory;
  const wardSolutions = (baseDetail?.proven_solutions ?? []).filter(
    (s) => !categoryForCluster || s.category === categoryForCluster
  );
  const forumByCategory =
    categoryForCluster != null
      ? forumSolutions.filter(
          (f) =>
            f.title.toLowerCase().includes(categoryForCluster.toLowerCase()) ||
            f.description.toLowerCase().includes(categoryForCluster.toLowerCase())
        )
      : forumSolutions;
  const solutionsForPanel: SolutionDisplay[] = (() => {
    const ward: SolutionDisplay[] = wardSolutions.slice(0, 2).map((sol) => ({ type: "ward" as const, sol }));
    const forum: SolutionDisplay[] = forumByCategory.slice(0, 2).map((sol) => ({ type: "forum" as const, sol }));
    return [...ward, ...forum].slice(0, 2);
  })();

  function getVerification(item: SolutionDisplay): VerificationMeta {
    if (item.type === "ward") {
      const sol = item.sol;
      const level: VerificationLevel = sol.verification_level ?? "community_documented";
      const headlines: Record<VerificationLevel, string> = {
        official_dataset: "Official / dataset",
        community_documented: "Community documented",
        knowledge_base: "Knowledge base pattern",
      };
      return {
        level,
        headline: headlines[level],
        detail:
          level === "official_dataset"
            ? "Tied to an official or structured source when you add the link."
            : level === "community_documented"
              ? "Documented by ward contributors or RWAs — confirm locally before relying on it."
              : "General pattern; validate in your ward.",
        sourceUrl: sol.source_url,
        sourceLabel: sol.source_label ?? sol.contributor_name,
        lastUpdated: sol.last_updated ?? "Set last_updated in ward data",
      };
    }
    return {
      level: "knowledge_base",
      headline: "Knowledge base",
      detail: "Reusable pattern from the community KB — not verified for this ward unless cited.",
      sourceUrl: undefined,
      sourceLabel: "Forum KB",
      lastUpdated: "Varies by topic",
    };
  }

  const verificationBadgeClass: Record<VerificationLevel, string> = {
    official_dataset: "border-blue-200 bg-blue-50 text-blue-900",
    community_documented: "border-emerald-200 bg-emerald-50 text-emerald-900",
    knowledge_base: "border-amber-200 bg-amber-50 text-amber-900",
  };

  const wardContactOverride =
    displayWard && wardContactsByWardId
      ? wardContactsByWardId[displayWard.id] ?? null
      : null;

  const promisesForPanel = displayWard
    ? promises.filter((p) => p.ward_id === null || p.ward_id === displayWard.id)
    : [];

  const primaryOfficePhone =
    wardContactOverride?.ward_office_phone?.replace(/\s/g, "") ||
    baseDetail?.councilor_contact?.replace(/\s/g, "") ||
    "";
  const canCallOffice =
    primaryOfficePhone.length > 0 && primaryOfficePhone !== "—" && /^[+\d]/.test(primaryOfficePhone);
  const officeEmail = wardContactOverride?.ward_office_email;

  function promiseStatusStyle(s: CivicPromiseRecord["status"]) {
    switch (s) {
      case "completed":
        return "bg-emerald-100 text-emerald-800";
      case "in_progress":
        return "bg-amber-100 text-amber-800";
      case "reported":
        return "bg-slate-100 text-slate-700";
      case "unclear":
        return "bg-rose-50 text-rose-800";
      default:
        return "bg-slate-100 text-slate-600";
    }
  }

  function splitAka(title: string): { plain: string; aka: string | null } {
    const m = title.match(/^(.*?)\s*\(AKA[:\s-]*(.+?)\)\s*$/i);
    if (!m) return { plain: title, aka: null };
    return { plain: m[1].trim(), aka: m[2].trim() };
  }

  const filteredChampionsRaw =
    activeCategory === "All"
      ? baseDetail?.local_champions ?? []
      : (baseDetail?.local_champions ?? []).filter((c) =>
          c.categories.includes(activeCategory)
        );
  const rawChampions = filteredChampionsRaw.length >= 2 ? filteredChampionsRaw : (baseDetail?.local_champions ?? []).slice(0, 2);
  const placeholderChampion: LocalChampionRecord = { name: "Local volunteer", expertise: "Community coordination", contact: "—", categories: ["Waste" as Category] };
  const filteredChampions = rawChampions.length >= 2 ? rawChampions : [...rawChampions, ...Array(2 - rawChampions.length).fill(placeholderChampion)].slice(0, 2);

  const detail = baseDetail;
  const openDataItems = actions
    .filter((a) => (displayWard?.id ? a.ward_id === displayWard.id : true))
    .slice(0, 4);

  if (compareMode) {
    const a = compareMetrics[0] ?? null;
    const b = compareMetrics[1] ?? null;
    const metricCmp = (
      key: "issues" | "openData" | "activeCitizens",
      lowerIsBetter: boolean
    ): "a" | "b" | "tie" | null => {
      if (!a || !b) return null;
      const av = a[key];
      const bv = b[key];
      if (av === bv) return "tie";
      if (lowerIsBetter) return av < bv ? "a" : "b";
      return av > bv ? "a" : "b";
    };

    return (
      <aside className="flex w-full flex-col bg-white/90 shadow-[0_0_40px_rgba(15,23,42,0.06)] md:w-[380px]">
        <div className="border-b border-sky-100 px-4 py-3 md:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">Compare areas</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-slate-500">
            <li>Use draw tools on the map (top-left): polygon or rectangle.</li>
            <li>Complete Area A, then draw Area B.</li>
            <li>See side-by-side metrics below.</li>
          </ol>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onResetCompareAreas}
              className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-700"
            >
              Clear drawings
            </button>
            <button
              type="button"
              onClick={onExitCompareMode}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
            >
              Exit compare mode
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5">
          {compareAreas.length < 2 ? (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Draw Area A and Area B to start comparison.
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            {compareAreas.map((area) => (
              <div key={area.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                <p className="text-xs font-semibold" style={{ color: area.color }}>{area.label}</p>
                <p className="text-[11px] text-slate-500">Area drawn on map</p>
              </div>
            ))}
          </div>
          {compareMetrics.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-100 bg-white p-3">
              <p className="text-xs font-semibold text-slate-800">Side-by-side comparison</p>
              {a && b ? (
                <div className="mt-2 overflow-hidden rounded-md border border-slate-100">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50">
                      <tr className="text-slate-600">
                        <th className="px-2 py-1 text-left font-semibold">Metric</th>
                        <th className="px-2 py-1 text-left font-semibold" style={{ color: a.color }}>{a.label}</th>
                        <th className="px-2 py-1 text-left font-semibold" style={{ color: b.color }}>{b.label}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-600">Issues (lower is better)</td>
                        <td className="px-2 py-1">{a.issues} {metricCmp("issues", true) === "a" ? "▲ better" : metricCmp("issues", true) === "tie" ? "—" : ""}</td>
                        <td className="px-2 py-1">{b.issues} {metricCmp("issues", true) === "b" ? "▲ better" : metricCmp("issues", true) === "tie" ? "—" : ""}</td>
                      </tr>
                      <tr className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-600">Open data points (higher is better)</td>
                        <td className="px-2 py-1">{a.openData} {metricCmp("openData", false) === "a" ? "▲ better" : metricCmp("openData", false) === "tie" ? "—" : ""}</td>
                        <td className="px-2 py-1">{b.openData} {metricCmp("openData", false) === "b" ? "▲ better" : metricCmp("openData", false) === "tie" ? "—" : ""}</td>
                      </tr>
                      <tr className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-600">Active citizens (higher is better)</td>
                        <td className="px-2 py-1">{a.activeCitizens} {metricCmp("activeCitizens", false) === "a" ? "▲ better" : metricCmp("activeCitizens", false) === "tie" ? "—" : ""}</td>
                        <td className="px-2 py-1">{b.activeCitizens} {metricCmp("activeCitizens", false) === "b" ? "▲ better" : metricCmp("activeCitizens", false) === "tie" ? "—" : ""}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {compareMetrics.map((m) => (
                    <div key={m.areaId} className="rounded-md border border-slate-100 px-2 py-2">
                      <p className="text-xs font-semibold" style={{ color: m.color }}>{m.label}</p>
                      <p className="text-[11px] text-slate-600">Issues: {m.issues}</p>
                      <p className="text-[11px] text-slate-600">Open data points: {m.openData}</p>
                      <p className="text-[11px] text-slate-600">Active citizens: {m.activeCitizens}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    );
  }

  if (!displayWard && !selectedAction) {
    return (
      <aside className="flex w-full flex-col items-center justify-center bg-white/90 px-6 py-12 text-center shadow-[0_0_40px_rgba(15,23,42,0.06)] md:w-[360px]">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-500">
          <MapPinned className="h-7 w-7" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-600">
          Select a locality to see details
        </p>
        <p className="mt-1 text-xs text-slate-400">
          You can start from the map or open a sample locality directly.
        </p>
        <button
          type="button"
          onClick={onPickSample}
          className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100"
        >
          Open sample locality
        </button>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {SIDEBAR_MODES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setMode(v.id)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600"
            >
              {v.label}
            </button>
          ))}
        </div>
      </aside>
    );
  }

  if (loading && !selectedAction) {
    return (
      <aside className="flex w-full flex-col items-center justify-center bg-white/90 px-6 py-12 text-center shadow-[0_0_40px_rgba(15,23,42,0.06)] md:w-[360px]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
        <p className="mt-4 text-sm font-medium text-slate-600">
          Loading…
        </p>
      </aside>
    );
  }

  if (!detail || !displayWard) {
    return (
      <aside className="flex w-full flex-col items-center justify-center bg-white/90 px-6 py-12 text-center shadow-[0_0_40px_rgba(15,23,42,0.06)] md:w-[360px]">
        <p className="text-sm font-medium text-slate-600">Ward details unavailable.</p>
      </aside>
    );
  }

  return (
    <aside className="flex w-full flex-col bg-white/90 shadow-[0_0_40px_rgba(15,23,42,0.06)] md:w-[360px]">
      <div className="border-b border-sky-100 px-4 py-3 md:px-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">
              Ward Snapshot
            </p>
            <p className="flex items-center gap-1 text-sm font-semibold text-slate-900">
              {displayWard.name}
            </p>
            {selectedAction && (
              <p className="mt-0.5 text-xs text-slate-500">
                Related action: {selectedAction.title.slice(0, 40)}{selectedAction.title.length > 40 ? "…" : ""}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SIDEBAR_MODES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setMode(v.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                mode === v.id
                  ? "border-sky-500 bg-sky-50 text-sky-700"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {SIDEBAR_MODES.find((m) => m.id === mode)?.helper}
        </p>
        {(mode === "solution_finder" || (mode === "local_signals" && signalsTab === "citizens")) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() =>
                  setActiveCategory(cat === "All" ? "All" : (cat as Category))
                }
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  activeCategory === cat
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-400"
                }`}
              >
                {cat === "All" ? "All" : cat}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5">
        {mode === "area_brief" && (
          <section className="space-y-3">
            <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-3 md:px-4 md:py-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-white">
                  <Phone className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Local governance</p>
                  <p className="text-sm font-medium text-slate-900">{detail.councilor_name}</p>
                  <p className="text-xs text-slate-500">{detail.description}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Status: {detail.status}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {canCallOffice ? (
                  <a
                    href={`tel:${primaryOfficePhone}`}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                  >
                    {wardContactOverride?.ward_office_phone ? "Call ward office" : "Contact council office"}
                  </a>
                ) : officeEmail ? (
                  <a
                    href={`mailto:${officeEmail}`}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                  >
                    Email ward office
                  </a>
                ) : (
                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    Add a phone or email in <code className="rounded bg-white px-1">ward_contacts.json</code> for this
                    ward.
                  </p>
                )}
                {officeEmail && canCallOffice && (
                  <a
                    href={`mailto:${officeEmail}`}
                    className="inline-flex w-full items-center justify-center rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    Email ward office
                  </a>
                )}
              </div>
            </div>

            {wardContactOverride && (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 md:px-4 md:py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Responsibility (JSON)</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Contacts below are loaded from <code className="rounded bg-slate-100 px-1">ward_contacts.json</code> —
                  verify before publishing.
                </p>
                <ul className="mt-2 space-y-1.5 text-[11px] text-slate-700">
                  {wardContactOverride.corporation && (
                    <li>
                      <span className="font-semibold text-slate-800">Corporation: </span>
                      {wardContactOverride.corporation}
                    </li>
                  )}
                  {wardContactOverride.zone_name && (
                    <li>
                      <span className="font-semibold text-slate-800">Zone: </span>
                      {wardContactOverride.zone_name}
                      {wardContactOverride.zone_office_phone && (
                        <span className="text-slate-500"> · {wardContactOverride.zone_office_phone}</span>
                      )}
                    </li>
                  )}
                  {wardContactOverride.ward_office_address && (
                    <li>
                      <span className="font-semibold text-slate-800">Ward office: </span>
                      {wardContactOverride.ward_office_address}
                    </li>
                  )}
                  {wardContactOverride.assistant_engineer_name && (
                    <li>
                      <span className="font-semibold text-slate-800">Engineering: </span>
                      {wardContactOverride.assistant_engineer_name}
                      {wardContactOverride.assistant_engineer_phone && (
                        <span> · {wardContactOverride.assistant_engineer_phone}</span>
                      )}
                    </li>
                  )}
                  {wardContactOverride.ward_page_url && (
                    <li>
                      <a
                        href={wardContactOverride.ward_page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"
                      >
                        Official ward / corporation page <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  )}
                </ul>
                {wardContactOverride.data_note && (
                  <p className="mt-2 text-[10px] text-slate-400">{wardContactOverride.data_note}</p>
                )}
              </div>
            )}

            <div className="rounded-xl border border-sky-100 bg-white px-3 py-3 md:px-4 md:py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Applicable boundaries</p>
              <div className="mt-1 space-y-1 text-[11px] text-slate-600">
                <p>🏛️ Ward: {displayWard.name}</p>
                {wardContactOverride?.corporation && wardContactOverride?.zone_name ? (
                  <>
                    <p>🏛️ {wardContactOverride.corporation}</p>
                    <p>📍 Zone: {wardContactOverride.zone_name}</p>
                    {wardContactOverride.bescom_circle && (
                      <p>💡 BESCOM: {wardContactOverride.bescom_circle}</p>
                    )}
                    {wardContactOverride.bwssb_sub_division && (
                      <p>💧 BWSSB: {wardContactOverride.bwssb_sub_division}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p>🏛️ Corporation / zone: add to ward_contacts.json for verified labels.</p>
                    <p>💡 BESCOM / 💧 BWSSB: add circles in JSON or keep local notes.</p>
                  </>
                )}
              </div>
            </div>

            {promisesForPanel.length > 0 && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-3 md:px-4 md:py-4">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-800">
                      Public commitments (pilot)
                    </p>
                    <p className="text-[11px] text-indigo-900/80">
                      Curated from <code className="rounded bg-white/80 px-1">promises.json</code>. Replace samples with
                      sourced commitments.
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {promisesForPanel.map((p) => (
                    <article
                      key={p.id}
                      className="rounded-lg border border-indigo-100 bg-white px-3 py-2 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${promiseStatusStyle(p.status)}`}
                        >
                          {p.status.replace("_", " ")}
                        </span>
                        {p.jurisdiction && (
                          <span className="text-[10px] text-slate-500">{p.jurisdiction}</span>
                        )}
                      </div>
                      <h3 className="mt-1 text-xs font-semibold text-slate-900">{p.title}</h3>
                      <p className="text-[11px] text-slate-600">{p.summary}</p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Actor: <span className="font-medium text-slate-700">{p.actor}</span>
                        {p.committed_at && (
                          <>
                            {" "}
                            · Committed: {p.committed_at}
                          </>
                        )}
                      </p>
                      {p.source_url && (
                        <a
                          href={p.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline"
                        >
                          {p.source_label || "Source"} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {mode === "local_signals" && (
          <section className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-3 md:px-4 md:py-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["issues", "open_data", "citizens"] as LocalSignalsTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSignalsTab(tab)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    signalsTab === tab
                      ? "border-slate-500 bg-white text-slate-800"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {tab === "issues" ? "Issues (citizen reports)" : tab === "open_data" ? "Open data (public records)" : "Active citizens"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {signalsTab === "issues"
                ? "Issues = resident-reported local problems."
                : signalsTab === "open_data"
                  ? "Open data = published civic records/events captured in this area."
                  : "Active citizens = local volunteers/champions who can help."}
            </p>

            {signalsTab === "issues" && (
              <div className="space-y-2">
                {(issuesForPanel.length >= 2
                  ? issuesForPanel
                  : [
                      ...issuesForPanel,
                      { description: "Other local issues in this area.", status: "Open" as const },
                      { description: "Resident-reported concern in locality.", status: "In Progress" as const },
                    ].slice(0, 2)
                ).map((issue, i) => (
                  <div key={i} className="flex items-start justify-between rounded-lg border border-slate-100 bg-white px-3 py-2">
                    <p className="text-xs font-semibold text-slate-800">{issue.description}</p>
                    <span
                      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        issue.status === "Solved"
                          ? "bg-emerald-600 text-white"
                          : issue.status === "In Progress"
                            ? "bg-amber-400 text-white"
                            : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {issue.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {signalsTab === "open_data" && (
              <div className="space-y-2">
                {openDataItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                    <p className="text-xs font-semibold text-slate-800">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {item.category} {item.type ? `· ${item.type}` : ""} {item.place_name ? `· ${item.place_name}` : ""}
                    </p>
                  </div>
                ))}
                {openDataItems.length === 0 && <p className="text-xs text-slate-400">No open data points available.</p>}
              </div>
            )}

            {signalsTab === "citizens" && (
              <div className="space-y-2">
                {filteredChampions.map((champion, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{champion.name}</p>
                      <p className="text-[11px] text-slate-500">{champion.expertise}</p>
                    </div>
                    <a
                      href={champion.contact.startsWith("+") ? `https://wa.me/${champion.contact.replace(/[^\d]/g, "")}` : `mailto:${champion.contact}`}
                      className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Contact
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {mode === "solution_finder" && (
          <section className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-3 md:px-4 md:py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Lightbulb className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Solutions</p>
                  <p className="text-xs text-emerald-900/70">Trust signals: official, community-documented, or KB pattern.</p>
                </div>
              </div>
              <div className="flex rounded-full border border-emerald-200 bg-white p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setSolutionsViewMode("text")}
                  className={`rounded-full px-2 py-0.5 ${solutionsViewMode === "text" ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}
                >
                  Text
                </button>
                <button
                  type="button"
                  onClick={() => setSolutionsViewMode("map")}
                  className={`rounded-full px-2 py-0.5 ${solutionsViewMode === "map" ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}
                >
                  Map
                </button>
              </div>
            </div>
            {solutionsViewMode === "map" && (
              <p className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-800">
                Map now shows solution-relevant data points{activeCategory !== "All" ? ` for ${activeCategory}` : ""}. Click markers to inspect details.
              </p>
            )}
            {solutionsViewMode === "text" && (
              <div className="space-y-2">
                <p className="rounded-lg border border-emerald-200/80 bg-white/90 px-2.5 py-2 text-[10px] leading-relaxed text-emerald-900/90">
                  <strong className="text-emerald-900">Legend:</strong>{" "}
                  <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-blue-900">Official</span>{" "}
                  structured source ·{" "}
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-emerald-900">
                    Community
                  </span>{" "}
                  RWA / ward doc ·{" "}
                  <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-amber-900">KB</span>{" "}
                  reusable pattern — confirm locally.
                </p>
                {solutionsForPanel.map((item, i) => {
                  const meta = getVerification(item);
                  const rawTitle = item.type === "ward" ? item.sol.issue : item.sol.title;
                  const { plain, aka } = splitAka(rawTitle);
                  return (
                    <div key={i} className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${verificationBadgeClass[meta.level]}`}
                        >
                          {meta.headline}
                        </span>
                        <span className="text-[10px] text-slate-500">Updated: {meta.lastUpdated}</span>
                      </div>
                      <p className="mt-1.5 text-xs font-semibold text-emerald-900">{plain}</p>
                      {aka && <p className="mt-0.5 text-[11px] text-emerald-700">AKA: {aka}</p>}
                      <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">{meta.detail}</p>
                      {meta.sourceUrl ? (
                        <a
                          href={meta.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline"
                        >
                          {meta.sourceLabel || "View source"} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <p className="mt-1 text-[10px] text-slate-400">
                          Provenance: {meta.sourceLabel}
                          {item.type === "ward" && !item.sol.source_url ? " — add source_url in ward data." : ""}
                        </p>
                      )}
                      <details className="mt-2 border-t border-emerald-50 pt-2">
                        <summary className="cursor-pointer select-none text-[11px] font-semibold text-emerald-700">
                          Full description
                        </summary>
                        <p className="mt-1 text-xs text-emerald-900/80 leading-relaxed">
                          {item.type === "ward" ? item.sol.fix_description : item.sol.description}
                        </p>
                      </details>
                    </div>
                  );
                })}
                {solutionsForPanel.length === 0 && (
                  <p className="text-xs text-slate-400">No solutions recorded for this area yet.</p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

export default function Home() {
  const [wards, setWards] = useState<WardRecord[]>([]);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [selectedWard, setSelectedWard] = useState<WardMeta | null>(null);
  const [wardDetailsMap, setWardDetailsMap] = useState<Record<
    string,
    WardRecord
  > | null>(null);
  const [wardsLoading, setWardsLoading] = useState(true);
  const [forumSolutions, setForumSolutions] = useState<ForumSolution[]>([]);
  const [promises, setPromises] = useState<CivicPromiseRecord[]>([]);
  const [wardContactsByWardId, setWardContactsByWardId] = useState<Record<
    string,
    WardContactRecord
  > | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    setWardsLoading(true);
    fetchWards()
      .then((list) => {
        setWards(list);
        const map: Record<string, WardRecord> = {};
        for (const w of list) {
          if (w.id) map[w.id] = w;
        }
        setWardDetailsMap(map);
      })
      .catch((err) => {
        console.error("Failed to load ward details", err);
        setWards([]);
        setWardDetailsMap({});
      })
      .finally(() => setWardsLoading(false));
  }, []);

  useEffect(() => {
    fetchActions().then(setActions).catch(() => setActions([]));
  }, []);

  useEffect(() => {
    fetchForumSolutions().then(setForumSolutions).catch(() => setForumSolutions([]));
  }, []);

  useEffect(() => {
    fetchPromises().then(setPromises).catch(() => setPromises([]));
  }, []);

  useEffect(() => {
    fetchWardContacts()
      .then(setWardContactsByWardId)
      .catch(() => setWardContactsByWardId({}));
  }, []);

  const center = useMemo<[number, number]>(() => [20.59, 78.96], []); // pan-India default

  const [selectedAction, setSelectedAction] = useState<ActionRecord | null>(null);
  const [askInput, setAskInput] = useState("");
  const [askReply, setAskReply] = useState<string | null>(null);
  const [flyToCenter, setFlyToCenter] = useState<[number, number] | null>(null);
  const [forceSidebarView, setForceSidebarView] = useState<SidebarMode | null>(null);
  const [forceSidebarCategory, setForceSidebarCategory] = useState<Category | "All" | null>(null);
  const [solutionsMapFilter, setSolutionsMapFilter] = useState<Category | "All" | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareAreas, setCompareAreas] = useState<CompareArea[]>([]);
  const [compareResetToken, setCompareResetToken] = useState(0);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);

  const openSampleLocality = () => {
    const w = wards[0];
    if (!w) return;
    setSelectedWard({ id: w.id, name: w.name });
    setSelectedAction(null);
    setForceSidebarView("area_brief");
    setFlyToCenter([w.latitude, w.longitude]);
    setTimeout(() => setFlyToCenter(null), 2000);
  };

  const selectLocation = (lat: number, lng: number, label?: string) => {
    const nearest = nearestWardFor(lat, lng, wards);
    if (nearest) {
      setSelectedWard({ id: nearest.id, name: nearest.name });
      setSelectedAction(null);
      setForceSidebarView("area_brief");
      setAskReply(label ? `${label} selected. Nearest ward: ${nearest.name}.` : `Nearest ward: ${nearest.name}.`);
    } else {
      setAskReply(label ? `${label} selected.` : "Location selected.");
    }
    setFlyToCenter([lat, lng]);
    setTimeout(() => setFlyToCenter(null), 2000);
  };

  const handleUseMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setAskReply("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        selectLocation(lat, lng, "Using your location");
      },
      () => setAskReply("Unable to access your location. Check browser permissions.")
    );
  };

  useEffect(() => {
    const q = locationQuery.trim();
    if (q.length < 3) {
      setLocationSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const run = async () => {
      try {
        setLocationLoading(true);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          setLocationSuggestions([]);
          return;
        }
        const data: unknown = await res.json();
        setLocationSuggestions(Array.isArray(data) ? (data as LocationSuggestion[]) : []);
      } catch {
        setLocationSuggestions([]);
      } finally {
        setLocationLoading(false);
      }
    };
    const t = setTimeout(run, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [locationQuery]);

  const handleAsk = () => {
    const q = askInput.trim();
    if (!q) {
      setAskReply("Type a question (e.g. ward name, place, waste, water, councilor).");
      return;
    }
    const result: AskResult = ask(q, wards, actions, wardDetailsMap);
    setAskReply(result.reply);
    if (result.kind === "ward") {
      setSelectedWard({ id: result.ward.id, name: result.ward.name });
      setSelectedAction(null);
      setForceSidebarView("area_brief");
      setForceSidebarCategory("All");
      setFlyToCenter([result.lat, result.lng]);
    } else if (result.kind === "action") {
      setSelectedAction(result.action);
      setForceSidebarView("local_signals");
      setForceSidebarCategory("All");
      if (result.ward) {
        setSelectedWard({ id: result.ward.id, name: result.ward.name });
      } else {
        setSelectedWard({
          id: result.action.ward_id || "synthetic",
          name: result.action.place_name || "Area",
        });
      }
      setFlyToCenter([result.lat, result.lng]);
    } else if (result.kind === "glossary") {
      setSelectedWard(null);
      setSelectedAction(null);
      setForceSidebarView("solution_finder");
      setForceSidebarCategory(result.entry.category ?? "All");
    } else {
      setSelectedWard(null);
      setSelectedAction(null);
    }
    // Clear flyTo after flying so next ask can trigger fly again
    setTimeout(() => setFlyToCenter(null), 2000);
    // Clear forced sidebar state after user sees it
    setTimeout(() => {
      setForceSidebarView(null);
      setForceSidebarCategory(null);
    }, 6000);
  };

  const handleMarkerClick = (ward: WardRecord) => {
    setSelectedWard({ id: ward.id, name: ward.name });
    setSelectedAction(null);
  };

  const handleActionClick = (action: ActionRecord) => {
    setSelectedAction(action);
    const wardId = action.ward_id;
    if (wardId && wardDetailsMap?.[wardId]) {
      setSelectedWard({ id: wardId, name: wardDetailsMap[wardId].name });
    }
  };

  const compareMetrics: CompareMetric[] = useMemo(() => {
    if (!compareMode || compareAreas.length === 0) return [];
    return compareAreas.map((area) => {
      const inAreaActions = actions.filter((a) => {
        if (typeof a.latitude !== "number" || typeof a.longitude !== "number") return false;
        return booleanPointInPolygon(point([a.longitude, a.latitude]), area.geometry as any);
      });
      const inAreaWards = wards.filter((w) => {
        if (typeof w.latitude !== "number" || typeof w.longitude !== "number") return false;
        return booleanPointInPolygon(point([w.longitude, w.latitude]), area.geometry as any);
      });
      const issues = inAreaWards.reduce((acc, w) => acc + (w.issues?.length ?? 0), 0) + inAreaActions.length;
      const openData = inAreaActions.length;
      const activeCitizens = inAreaWards.reduce((acc, w) => acc + (w.local_champions?.length ?? 0), 0);
      return {
        areaId: area.id,
        label: area.label,
        color: area.color,
        issues,
        openData,
        activeCitizens,
      };
    });
  }, [compareMode, compareAreas, actions, wards]);

  return (
    <div className="flex min-h-screen flex-col bg-sky-50">
      <header className="border-b border-sky-100 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 md:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <a
                href="https://samaajdata.org"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-600 text-white shadow-sm hover:bg-sky-700"
                title="Samaaj Data — collective civic intelligence"
              >
                <MapPin className="h-4 w-4" />
              </a>
              <div>
                <a
                  href="https://samaajdata.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600 hover:text-sky-700"
                >
                  Samaaj Data
                </a>
                <p className="text-sm font-medium text-slate-800">
                  Ward Intelligence Console
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-100 bg-sky-50/80 px-2 py-1 text-[11px] font-medium text-sky-800 hover:bg-sky-100 md:hidden"
              >
                <Info className="h-3.5 w-3.5" />
                About
              </button>
            </div>
            <div className="flex flex-1 items-center gap-2 sm:max-w-md">
              <div className="relative flex-1">
                <MessageCircle className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search solutions, places, wards, or topics…"
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                  className="w-full rounded-lg border border-sky-200 bg-white py-2 pl-9 pr-10 text-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={handleAsk}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-sky-600 hover:bg-sky-50"
                  aria-label="Search"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="hidden flex-col items-end gap-1 text-xs text-slate-500 md:flex">
              <div className="flex items-center gap-4">
                <span>Bengaluru · Pilot</span>
                <span className="h-4 w-px bg-slate-200" />
                <span>For city officials & citizens</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <a
                  href="https://samaajdata.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-sky-600 hover:underline"
                >
                  samaajdata.org — collective civic intelligence
                </a>
                <span className="hidden h-4 w-px bg-slate-200 sm:block" aria-hidden />
                <button
                  type="button"
                  onClick={() => setAboutOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-sky-700"
                >
                  <Info className="h-3.5 w-3.5" />
                  About console
                </button>
              </div>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Tip: search finds <strong className="font-medium text-slate-600">solutions</strong> (knowledge base), wards, and citizen reports. Use <strong className="font-medium text-slate-600">Local data</strong> to browse issues and map clusters.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
            <p className="text-xs font-semibold text-sky-700">Choose location:</p>
            <button
              type="button"
              title="Draw two shapes on the map to compare issues, open data, and active citizens side by side."
              onClick={() => {
                setCompareMode((v) => !v);
                setCompareAreas([]);
                setAskReply(
                  compareMode
                    ? "Compare mode turned off."
                    : "Compare mode: draw Area A and Area B on the map (polygon or rectangle). We’ll show a side-by-side comparison."
                );
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                compareMode ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-sky-200 bg-white text-sky-700"
              }`}
            >
              {compareMode ? "Exit compare mode" : "Compare areas"}
            </button>
            <span className="hidden text-[10px] text-slate-500 sm:inline max-w-[200px]">
              Draw two areas on the map to compare metrics.
            </span>
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <input
                type="text"
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                placeholder="Search by address/locality"
                className="w-full rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[11px] text-slate-700 placeholder:text-slate-400"
              />
              {locationLoading && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">...</span>
              )}
              {locationSuggestions.length > 0 && (
                <div className="absolute z-[1200] mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-sky-100 bg-white shadow-lg">
                  {locationSuggestions.map((s, i) => (
                    <button
                      key={`${s.lat}-${s.lon}-${i}`}
                      type="button"
                      onClick={() => {
                        setLocationQuery(s.display_name);
                        setLocationSuggestions([]);
                        selectLocation(Number(s.lat), Number(s.lon), "Address");
                      }}
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left text-[11px] text-slate-700 hover:bg-sky-50"
                    >
                      {s.display_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={openSampleLocality}
              className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700"
            >
              Open sample locality
            </button>
            <button
              type="button"
              onClick={handleUseMyLocation}
              className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700"
            >
              <LocateFixed className="h-3 w-3" />
              Use my location
            </button>
            <select
              onChange={(e) => {
                const ward = wards.find((w) => w.id === e.target.value);
                if (!ward) return;
                setSelectedWard({ id: ward.id, name: ward.name });
                setSelectedAction(null);
                setForceSidebarView("area_brief");
                setFlyToCenter([ward.latitude, ward.longitude]);
                setTimeout(() => setFlyToCenter(null), 2000);
              }}
              className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] text-slate-700"
              defaultValue=""
            >
              <option value="" disabled>Pick boundary (ward)</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          {askReply != null && (
            <p className="mt-2 text-xs text-slate-600 border-t border-sky-100 pt-2">
              {askReply}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto flex min-h-0 flex-1 w-full max-w-6xl flex-col md:flex-row md:h-[calc(100vh-3.5rem-5.5rem)]">
        <section className="h-64 border-b border-sky-100 bg-slate-900 md:h-auto md:flex-1 md:border-b-0 md:border-r">
          <WardMap
            center={center}
            wards={wards}
            actions={actions}
            selectedWardId={selectedWard?.id ?? null}
            selectedActionId={selectedAction?.id ?? null}
            flyTo={flyToCenter}
            solutionCategoryFilter={solutionsMapFilter}
            compareMode={compareMode}
            compareResetToken={compareResetToken}
            onCompareAreasChange={setCompareAreas}
            onWardClick={handleMarkerClick}
            onActionClick={handleActionClick}
          />
        </section>

        <Sidebar
          selectedWard={selectedWard}
          selectedAction={selectedAction}
          wardDetailsMap={wardDetailsMap}
          forumSolutions={forumSolutions}
          promises={promises}
          wardContactsByWardId={wardContactsByWardId}
          actions={actions}
          onPickSample={openSampleLocality}
          onSolutionsMapFilterChange={setSolutionsMapFilter}
          compareMode={compareMode}
          compareAreas={compareAreas}
          compareMetrics={compareMetrics}
          onExitCompareMode={() => {
            setCompareMode(false);
            setCompareAreas([]);
            setAskReply("Compare mode turned off.");
          }}
          onResetCompareAreas={() => {
            setCompareAreas([]);
            setCompareResetToken((v) => v + 1);
            setAskReply("Drawings cleared. Draw Area A and Area B again.");
          }}
          loading={wardsLoading}
          selectionType={selectedAction ? "action" : selectedWard ? "ward" : null}
          forceView={forceSidebarView}
          forceCategory={forceSidebarCategory}
        />
      </main>

      <footer className="border-t border-sky-100 bg-white/90 py-3 text-center text-[11px] text-slate-500">
        <p>
          <a
            href="https://samaajdata.org"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-sky-700 hover:underline"
          >
            Samaaj Data
          </a>
          {" "}is a collective for civic data, governance context, and citizen action — not a single product alone.
        </p>
        <p className="mt-1">
          This console helps you search <strong className="font-medium text-slate-600">solutions</strong>, explore{" "}
          <strong className="font-medium text-slate-600">local data</strong> on map and lists, find{" "}
          <strong className="font-medium text-slate-600">local governance</strong> contacts, and{" "}
          <strong className="font-medium text-slate-600">connect with active citizens</strong> where listed.
        </p>
        <p className="mt-1 text-slate-400">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="font-medium text-sky-700 hover:underline"
          >
            About this console
          </button>
        </p>
      </footer>
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
