"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMap } from "react-leaflet";
import type { WardRecord } from "@/services/wards";
import type { ActionRecord } from "@/services/actions";

import "react-leaflet-cluster/dist/assets/MarkerCluster.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.Default.css";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false }
);
const MarkerClusterGroup = dynamic(
  () => import("react-leaflet-cluster"),
  { ssr: false }
);

import "leaflet-draw/dist/leaflet.draw.css";

/** Listens to flyTo prop and flies the map to that point. Rendered inside MapContainer. */
function FlyTo({ flyTo }: { flyTo: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!flyTo) return;
    map.flyTo(flyTo, 12, { duration: 1 });
  }, [map, flyTo?.[0], flyTo?.[1]]);
  return null;
}

type CompareArea = {
  id: string;
  label: string;
  color: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

function CompareDrawTools({
  enabled,
  onAreasChange,
  resetToken,
}: {
  enabled: boolean;
  onAreasChange: (areas: CompareArea[]) => void;
  resetToken: number;
}) {
  const DRAW_CREATED = "draw:created";
  const DRAW_EDITED = "draw:edited";
  const DRAW_DELETED = "draw:deleted";
  const map = useMap();
  const drawControlRef = useRef<any>(null);
  const featureGroupRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const isInitializedRef = useRef(false);
  const lastResetTokenRef = useRef<number>(0);
  const onAreasChangeRef = useRef(onAreasChange);
  const enabledRef = useRef(enabled);
  const controlAttachedRef = useRef(false);
  const colors = useRef(["#2563eb", "#059669"]);
  const labels = useRef(["Area A", "Area B"]);

  useEffect(() => {
    onAreasChangeRef.current = onAreasChange;
  }, [onAreasChange]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const emit = () => {
    const featureGroup = featureGroupRef.current;
    if (!featureGroup) return;
    const layers: any[] = [];
    featureGroup.eachLayer((layer: any) => layers.push(layer));
    const areas = layers.slice(0, 2).map((layer, i) => ({
      id: `cmp-${i + 1}`,
      label: labels.current[i],
      color: colors.current[i],
      geometry: layer.toGeoJSON().geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    }));
    onAreasChangeRef.current(areas);
  };

  const teardown = () => {
    const L = leafletRef.current;
    if (L && (map as any)._compareOnCreated) {
      map.off(DRAW_CREATED, (map as any)._compareOnCreated);
      map.off(DRAW_EDITED, (map as any)._compareOnEdited);
      map.off(DRAW_DELETED, (map as any)._compareOnDeleted);
      (map as any)._compareOnCreated = null;
      (map as any)._compareOnEdited = null;
      (map as any)._compareOnDeleted = null;
    }
    if (drawControlRef.current) {
      if (controlAttachedRef.current) map.removeControl(drawControlRef.current);
      drawControlRef.current = null;
      controlAttachedRef.current = false;
    }
    if (featureGroupRef.current) {
      map.removeLayer(featureGroupRef.current);
      featureGroupRef.current = null;
    }
    isInitializedRef.current = false;
    onAreasChangeRef.current([]);
  };

  useEffect(() => {
    let cancelled = false;
    if (isInitializedRef.current) {
      // Reset only when resetToken changes; do not clear on normal rerenders.
      if (resetToken !== lastResetTokenRef.current && featureGroupRef.current) {
        lastResetTokenRef.current = resetToken;
        featureGroupRef.current.clearLayers();
        emit();
      }
      return;
    }

    import("leaflet").then((L) => {
      if (cancelled) return;
      leafletRef.current = L;
      import("leaflet-draw").then(() => {
        if (cancelled || isInitializedRef.current) return;
        const featureGroup = new L.FeatureGroup();
        featureGroupRef.current = featureGroup;
        map.addLayer(featureGroup);
        const drawControl = new (L.Control as any).Draw({
          draw: {
            polygon: true,
            rectangle: true,
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false,
          },
          edit: {
            featureGroup,
            remove: true,
          },
        });
        drawControlRef.current = drawControl;
        map.addControl(drawControl);
        controlAttachedRef.current = true;

        const onCreated = (e: any) => {
          if (!enabledRef.current) return;
          const count = featureGroup.getLayers().length;
          if (count >= 2) return;
          const layer = e.layer;
          layer.setStyle?.({
            color: colors.current[count],
            fillColor: colors.current[count],
            fillOpacity: 0.15,
            weight: 2,
          });
          featureGroup.addLayer(layer);
          emit();
        };
        const onEdited = () => emit();
        const onDeleted = () => emit();
        (map as any)._compareOnCreated = onCreated;
        (map as any)._compareOnEdited = onEdited;
        (map as any)._compareOnDeleted = onDeleted;
        map.on(DRAW_CREATED, onCreated);
        map.on(DRAW_EDITED, onEdited);
        map.on(DRAW_DELETED, onDeleted);
        isInitializedRef.current = true;
        lastResetTokenRef.current = resetToken;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [map, resetToken]);

  useEffect(() => {
    if (!isInitializedRef.current) return;
    // Only clear when compare mode is explicitly disabled.
    if (!enabled) {
      if (featureGroupRef.current) {
        featureGroupRef.current.clearLayers();
      }
      onAreasChangeRef.current([]);
      if (drawControlRef.current && controlAttachedRef.current) {
        map.removeControl(drawControlRef.current);
        controlAttachedRef.current = false;
      }
      return;
    }
    if (enabled && drawControlRef.current && !controlAttachedRef.current) {
      map.addControl(drawControlRef.current);
      controlAttachedRef.current = true;
    }
  }, [enabled, map]);

  useEffect(() => {
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

const MAX_ACTIONS_ON_MAP = 800;

type ColorKey = "green" | "blue" | "amber" | "purple" | "gray";

function getActionColorKey(category: string): ColorKey {
  const c = (category || "").toLowerCase();
  if (c.includes("waste") || c.includes("solid")) return "green";
  if (c.includes("water") || c.includes("sanitation")) return "blue";
  if (c.includes("safety") || c.includes("street") || c.includes("traffic") || c.includes("road")) return "amber";
  if (c.includes("health") || c.includes("civic")) return "purple";
  return "gray";
}

const COLOR_MAP: Record<ColorKey, string> = {
  green: "#059669",
  blue: "#0ea5e9",
  amber: "#d97706",
  purple: "#7c3aed",
  gray: "#6b7280",
};

function createPinIcon(L: typeof import("leaflet"), fill: string): ReturnType<typeof L.divIcon> {
  return L.divIcon({
    className: "action-pin-marker",
    html: `<span style="display:block;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:22px solid ${fill};filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 22],
  });
}

interface WardMapProps {
  center: [number, number];
  wards: WardRecord[];
  actions: ActionRecord[];
  selectedWardId: string | null;
  selectedActionId: string | null;
  /** When set, map flies to this [lat, lng] (e.g. from "Ask" search). */
  flyTo: [number, number] | null;
  /** When set, show only solution-relevant action markers on map. */
  solutionCategoryFilter?: "All" | "Waste" | "Water" | "Safety" | "Health" | null;
  compareMode?: boolean;
  compareResetToken?: number;
  onCompareAreasChange?: (areas: CompareArea[]) => void;
  onWardClick: (ward: WardRecord) => void;
  onActionClick: (action: ActionRecord) => void;
}

export default function WardMap({
  center,
  wards,
  actions,
  selectedWardId,
  selectedActionId,
  flyTo,
  solutionCategoryFilter = null,
  compareMode = false,
  compareResetToken = 0,
  onCompareAreasChange,
  onWardClick,
  onActionClick,
}: WardMapProps) {
  const [mounted, setMounted] = useState(false);
  const [mapKey, setMapKey] = useState<string | null>(null);
  const [actionIcons, setActionIcons] = useState<Record<ColorKey, ReturnType<typeof createPinIcon> | null>>({
    green: null, blue: null, amber: null, purple: null, gray: null,
  });

  useEffect(() => {
    setMapKey(`ward-map-${Math.random().toString(36).slice(2, 11)}`);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    import("leaflet").then((L) => {
      const DefaultIcon = L.Icon.Default as unknown as {
        prototype: { _getIconUrl?: string };
        mergeOptions: (o: unknown) => void;
      };
      if (DefaultIcon.prototype._getIconUrl) {
        delete DefaultIcon.prototype._getIconUrl;
      }
      DefaultIcon.mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      setActionIcons({
        green: createPinIcon(L, COLOR_MAP.green),
        blue: createPinIcon(L, COLOR_MAP.blue),
        amber: createPinIcon(L, COLOR_MAP.amber),
        purple: createPinIcon(L, COLOR_MAP.purple),
        gray: createPinIcon(L, COLOR_MAP.gray),
      });
    });
  }, [mounted]);

  if (!mounted || mapKey === null) {
    return (
      <div className="h-full w-full bg-slate-800" aria-hidden />
    );
  }

  const wardsWithCoords = wards.filter(
    (w) => typeof w.latitude === "number" && typeof w.longitude === "number"
  );

  const actionsWithCoords = actions
    .filter(
      (a) =>
        typeof a.latitude === "number" &&
        typeof a.longitude === "number" &&
        a.ward_id
    )
    .filter((a) => {
      if (!solutionCategoryFilter || solutionCategoryFilter === "All") return true;
      const c = (a.category || "").toLowerCase();
      if (solutionCategoryFilter === "Waste") return c.includes("waste") || c.includes("solid");
      if (solutionCategoryFilter === "Water") return c.includes("water") || c.includes("sanitation");
      if (solutionCategoryFilter === "Safety") return c.includes("safety") || c.includes("street") || c.includes("traffic") || c.includes("road");
      if (solutionCategoryFilter === "Health") return c.includes("health") || c.includes("civic");
      return true;
    })
    .slice(0, MAX_ACTIONS_ON_MAP);

  return (
    <div key={mapKey} className="h-full w-full">
      <MapContainer
        center={center}
        zoom={5}
        minZoom={4}
        scrollWheelZoom
        className="h-full w-full"
      >
        <FlyTo flyTo={flyTo} />
        <CompareDrawTools
          enabled={compareMode}
          resetToken={compareResetToken}
          onAreasChange={onCompareAreasChange ?? (() => {})}
        />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MarkerClusterGroup>
          {actionsWithCoords.map((action) => {
            const colorKey = getActionColorKey(action.category);
            const icon = actionIcons[colorKey];
            if (!icon) return null;
            return (
              <Marker
                key={action.id}
                position={[action.latitude, action.longitude]}
                icon={icon}
                eventHandlers={{
                  click: () => onActionClick(action),
                }}
              >
                <Popup>
                  <div className="min-w-[200px] text-left">
                    <p className="font-semibold text-slate-900 text-sm">
                      {action.title}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {action.category}
                      {action.type ? ` · ${action.type}` : ""}
                      {action.place_name ? ` · ${action.place_name}` : ""}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Click to open details in panel →
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {wardsWithCoords.map((ward) => (
            <Marker
              key={ward.id}
              position={[ward.latitude, ward.longitude]}
              eventHandlers={{
                click: () => onWardClick(ward),
              }}
            >
              <Popup>
                <span className="text-sm font-medium">{ward.name}</span>
                <p className="text-xs text-slate-500">Click to open ward details →</p>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}
