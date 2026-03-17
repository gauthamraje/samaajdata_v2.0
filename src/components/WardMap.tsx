"use client";

import { useEffect, useState } from "react";
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

/** Listens to flyTo prop and flies the map to that point. Rendered inside MapContainer. */
function FlyTo({ flyTo }: { flyTo: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!flyTo) return;
    map.flyTo(flyTo, 12, { duration: 1 });
  }, [map, flyTo?.[0], flyTo?.[1]]);
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
