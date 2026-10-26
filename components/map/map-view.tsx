"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { allPoints, GREY_HEX, STATUS_HEX, STORE_HEX, type MapModel } from "@/lib/map";

// The Leaflet map. Loaded only in the browser (dynamic import with ssr: false), because Leaflet needs `window`.
// Tiles come from OpenStreetMap; if they don't load, the markers, catchments and arrows still show on the pale base.

const KARNATAKA: [number, number] = [14.3, 76.2];

const storeIcon = L.divIcon({ className: "", html: '<div class="store-sq"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

function arrowIcon(bearing: number, color: string) {
  return L.divIcon({
    className: "arrow-tip",
    html: `<svg width="18" height="18" viewBox="0 0 18 18" style="transform: rotate(${bearing}deg)"><path d="M9 1 L16 16 L9 12 L2 16 Z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function FitTo({ model, fitKey }: { model: MapModel; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    const pts = allPoints(model).map((p) => [p.lat, p.lng] as [number, number]);
    if (pts.length === 0) map.setView(KARNATAKA, 7);
    else if (pts.length === 1) map.setView(pts[0], 13);
    else map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 14 });
    // Only re-fit when the view key changes (city, filters), not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

export interface MapViewProps {
  model: MapModel;
  showCatchments: boolean;
  showArrows: boolean;
  /** Changes when the view should be re-fitted (a different city or filter). */
  fitKey: string;
  onOpenApplicant?: (id: string) => void;
  className?: string;
  scrollWheelZoom?: boolean;
}

export default function MapView({ model, showCatchments, showArrows, fitKey, onOpenApplicant, className, scrollWheelZoom = true }: MapViewProps) {
  return (
    <MapContainer center={KARNATAKA} zoom={7} scrollWheelZoom={scrollWheelZoom} className={className ?? "h-full w-full"} aria-label="Map of existing stores and new allocations">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={18} />
      <FitTo model={model} fitKey={fitKey} />

      {showCatchments
        ? model.stores.map((s) => (
            <Circle key={`c-${s.id}`} center={[s.lat, s.lng]} radius={s.radiusKm * 1000} pathOptions={{ color: STORE_HEX, weight: 1.2, dashArray: "4 4", fillColor: STORE_HEX, fillOpacity: 0.06 }} interactive={false} />
          ))
        : null}
      {showCatchments
        ? model.allocations.map((a) => (
            <Circle key={`ca-${a.id}`} center={[a.lat, a.lng]} radius={a.radiusKm * 1000} pathOptions={{ color: STATUS_HEX[a.status], weight: 1.2, fillColor: STATUS_HEX[a.status], fillOpacity: 0.12 }} interactive={false} />
          ))
        : null}

      {showArrows
        ? model.arrows.map((a) => (
            <Polyline key={`l-${a.id}`} positions={[[a.from.lat, a.from.lng], [a.to.lat, a.to.lng]]} pathOptions={{ color: STATUS_HEX[a.status], weight: 2.5, dashArray: "7 7", opacity: 0.9 }} interactive={false} />
          ))
        : null}
      {showArrows
        ? model.arrows.map((a) => (
            <Marker
              key={`h-${a.id}`}
              position={[(a.from.lat + a.to.lat * 3) / 4, (a.from.lng + a.to.lng * 3) / 4]}
              icon={arrowIcon(a.bearing, STATUS_HEX[a.status])}
              interactive={false}
              keyboard={false}
            />
          ))
        : null}

      {model.origins.map((o) => (
        <CircleMarker key={`o-${o.id}`} center={[o.lat, o.lng]} radius={7} pathOptions={{ color: STATUS_HEX[o.status], weight: 2, dashArray: "3 3", fillColor: "#fff", fillOpacity: 1 }}>
          <Tooltip>{o.label}, redirected to {o.toPin}</Tooltip>
        </CircleMarker>
      ))}

      {model.waiting.map((w) => (
        <CircleMarker
          key={`w-${w.id}`}
          center={[w.lat, w.lng]}
          radius={5}
          pathOptions={{ color: "#fff", weight: 1.5, fillColor: GREY_HEX, fillOpacity: 0.95 }}
          eventHandlers={onOpenApplicant ? { click: () => onOpenApplicant(w.id) } : undefined}
        >
          <Tooltip>{w.label}</Tooltip>
        </CircleMarker>
      ))}

      {model.stores.map((s) => (
        <Marker key={`s-${s.id}`} position={[s.lat, s.lng]} icon={storeIcon} title={s.label}>
          <Tooltip>{s.label}</Tooltip>
        </Marker>
      ))}

      {model.allocations.map((a) => (
        <CircleMarker
          key={`a-${a.id}`}
          center={[a.lat, a.lng]}
          radius={9}
          pathOptions={{ color: "#fff", weight: 2.5, fillColor: STATUS_HEX[a.status], fillOpacity: 1 }}
          eventHandlers={onOpenApplicant ? { click: () => onOpenApplicant(a.id) } : undefined}
        >
          <Tooltip>{a.label}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
