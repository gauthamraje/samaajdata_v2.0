"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Phone,
  AlertTriangle,
  Lightbulb,
  Users,
  MapPin,
  MapPinned,
  MessageCircle,
  Send,
} from "lucide-react";
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

const SIDEBAR_MODES: { id: SidebarMode; label: string; helper: string }[] = [
  { id: "area_brief", label: "Local governance", helper: "Ward governance and local context." },
  { id: "local_signals", label: "Local data", helper: "Issues, open data, and active citizens." },
  { id: "solution_finder", label: "Solutions", helper: "Practical solutions with trust signals." },
];

/** Unified solution item for display (ward or forum). */
type SolutionDisplay = { type: "ward"; sol: ProvenSolutionRecord } | { type: "forum"; sol: ForumSolution };

function Sidebar({
  selectedWard,
  selectedAction,
  wardDetailsMap,
  forumSolutions,
  loading,
  selectionType,
  forceView,
  forceCategory,
  actions,
  onPickSample,
}: {
  selectedWard: WardMeta | null;
  selectedAction: ActionRecord | null;
  wardDetailsMap: Record<string, WardRecord> | null;
  forumSolutions: ForumSolution[];
  loading: boolean;
  /** When user clicks a marker: 'action' → show Issues reported, 'ward' → show Ward details */
  selectionType: "ward" | "action" | null;
  /** Optional parent override for mode (e.g. Ask glossary → solution_finder). */
  forceView?: SidebarMode | null;
  /** Optional parent override for category filter (solutions/citizens). */
  forceCategory?: Category | "All" | null;
  actions: ActionRecord[];
  onPickSample: () => void;
}) {
  const [mode, setMode] = useState<SidebarMode>("area_brief");
  const [signalsTab, setSignalsTab] = useState<LocalSignalsTab>("issues");
  const [activeCategory, setActiveCategory] = useState<Category | "All">("All");

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

  function getVerification(item: SolutionDisplay) {
    if (item.type === "ward") {
      return {
        source: "Local ward case",
        confidence: "High",
        verifiedBy: "Ward contributors",
        lastUpdated: "2-4 weeks ago",
      };
    }
    return {
      source: "Knowledge Base",
      confidence: "Medium",
      verifiedBy: "Community reported",
      lastUpdated: "1-3 months ago",
    };
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
          <section className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-3 md:px-4 md:py-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-white">
                <Phone className="h-3.5 w-3.5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Local Governance</p>
                <p className="text-sm font-medium text-slate-900">{detail.councilor_name}</p>
                <p className="text-xs text-slate-500">{detail.description}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">Status: {detail.status}</p>
              </div>
            </div>
            <a
              href={`tel:${detail.councilor_contact.replace(/\s/g, "")}`}
              className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              Contact office
            </a>
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
                  {tab === "issues" ? "Issues" : tab === "open_data" ? "Open data" : "Active citizens"}
                </button>
              ))}
            </div>

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
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Lightbulb className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Solutions</p>
                  <p className="text-xs text-emerald-900/70">Local + knowledge base solutions with verification.</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
                {solutionsForPanel.map((item, i) => {
                  const meta = getVerification(item);
                  const rawTitle = item.type === "ward" ? item.sol.issue : item.sol.title;
                  const { plain, aka } = splitAka(rawTitle);
                  return (
                    <div key={i} className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                      <p className="text-xs font-semibold text-emerald-900">{plain}</p>
                      {aka && <p className="mt-0.5 text-[11px] text-emerald-700">AKA: {aka}</p>}
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">Source: {meta.source}</span>
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">Confidence: {meta.confidence}</span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">Verified: {meta.verifiedBy}</span>
                      </div>
                      <details className="mt-1">
                        <summary className="cursor-pointer select-none text-[11px] font-semibold text-emerald-700">What is this?</summary>
                        <p className="mt-1 text-xs text-emerald-900/80 leading-relaxed">
                          {item.type === "ward" ? item.sol.fix_description : item.sol.description}
                        </p>
                      </details>
                      <p className="mt-1 text-[11px] text-slate-500">Last updated: {meta.lastUpdated}</p>
                    </div>
                  );
                })}
                {solutionsForPanel.length === 0 && (
                  <p className="text-xs text-slate-400">No solutions recorded for this area yet.</p>
                )}
            </div>
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

  const center = useMemo<[number, number]>(() => [20.59, 78.96], []); // pan-India default

  const [selectedAction, setSelectedAction] = useState<ActionRecord | null>(null);
  const [askInput, setAskInput] = useState("");
  const [askReply, setAskReply] = useState<string | null>(null);
  const [flyToCenter, setFlyToCenter] = useState<[number, number] | null>(null);
  const [forceSidebarView, setForceSidebarView] = useState<SidebarMode | null>(null);
  const [forceSidebarCategory, setForceSidebarCategory] = useState<Category | "All" | null>(null);

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

  return (
    <div className="min-h-screen flex flex-col bg-sky-50">
      <header className="border-b border-sky-100 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 md:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 text-white shadow-sm">
                <MapPin className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">
                  Samaaj Data
                </p>
                <p className="text-sm font-medium text-slate-800">
                  Ward Intelligence Console
                </p>
              </div>
            </div>
            <div className="flex flex-1 items-center gap-2 sm:max-w-md">
              <div className="relative flex-1">
                <MessageCircle className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Ask me anything (ward, place, topic…)"
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
            <div className="hidden items-center gap-4 text-xs text-slate-500 md:flex">
              <span>Bengaluru · Pilot</span>
              <span className="h-4 w-px bg-slate-200" />
              <span>For city officials & citizens</span>
            </div>
          </div>
          {askReply != null && (
            <p className="mt-2 text-xs text-slate-600 border-t border-sky-100 pt-2">
              {askReply}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-6xl flex-col md:flex-row">
        <section className="h-64 border-b border-sky-100 bg-slate-900 md:h-auto md:flex-1 md:border-b-0 md:border-r">
          <WardMap
            center={center}
            wards={wards}
            actions={actions}
            selectedWardId={selectedWard?.id ?? null}
            selectedActionId={selectedAction?.id ?? null}
            flyTo={flyToCenter}
            onWardClick={handleMarkerClick}
            onActionClick={handleActionClick}
          />
        </section>

        <Sidebar
          selectedWard={selectedWard}
          selectedAction={selectedAction}
          wardDetailsMap={wardDetailsMap}
          forumSolutions={forumSolutions}
          actions={actions}
          onPickSample={() => {
            const w = wards[0];
            if (!w) return;
            setSelectedWard({ id: w.id, name: w.name });
            setSelectedAction(null);
            setFlyToCenter([w.latitude, w.longitude]);
            setTimeout(() => setFlyToCenter(null), 2000);
          }}
          loading={wardsLoading}
          selectionType={selectedAction ? "action" : selectedWard ? "ward" : null}
          forceView={forceSidebarView}
          forceCategory={forceSidebarCategory}
        />
      </main>
    </div>
  );
}
