import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ApiError, getMap, type MapData, type StationSummary } from "../api";
import { METRICS } from "../config";
import { getPosition, levelColor, timeAgo } from "../geo";
import { StarDisplay } from "../Stars";

const TAIPEI: L.LatLngTuple = [25.0418, 121.5371];

function markerIcon(s: StationSummary) {
  const n = s.excellent.length;
  return L.divIcon({
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html:
      `<div class="map-pin" style="background:${levelColor(s.avg)}">${s.avg.toFixed(1)}` +
      (n > 0 ? `<span class="map-badge">★${n}</span>` : "") +
      `</div>`,
  });
}

export function MapPage({ onOpenBike }: { onOpenBike: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyExcellent, setOnlyExcellent] = useState(false);
  const [selected, setSelected] = useState<StationSummary | null>(null);

  useEffect(() => {
    getMap()
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false }).setView(TAIPEI, 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    m.on("click", () => setSelected(null));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  const shown = useMemo(
    () => (data?.stations ?? []).filter((s) => !onlyExcellent || s.excellent.length > 0),
    [data, onlyExcellent],
  );
  const excellentTotal = useMemo(
    () => (data?.stations ?? []).reduce((n, s) => n + s.excellent.length, 0),
    [data],
  );

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const s of shown) {
      L.marker([s.lat, s.lng], { icon: markerIcon(s), title: s.name })
        .on("click", () => setSelected(s))
        .addTo(g);
    }
  }, [shown]);

  // 第一次拿到資料時把所有站點放進畫面
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !map.current || !data || data.stations.length === 0) return;
    fitted.current = true;
    map.current.fitBounds(L.latLngBounds(data.stations.map((s) => [s.lat, s.lng])), {
      padding: [40, 40],
      maxZoom: 15,
    });
  }, [data]);

  async function locateMe() {
    const pos = await getPosition();
    if (pos) map.current?.setView([pos.lat, pos.lng], 16);
  }

  return (
    <div className="map-page">
      <div className="map-bar">
        <span>
          {error ? (
            <span className="error">{error}</span>
          ) : !data ? (
            "載入中…"
          ) : data.stations.length === 0 ? (
            "還沒有人在還車時評分，來當第一個吧"
          ) : (
            <>
              極品車 <b>{excellentTotal}</b> 台 · {data.stations.length} 站有資料
            </>
          )}
        </span>
        <button
          className={`small toggle${onlyExcellent ? " on" : ""}`}
          aria-pressed={onlyExcellent}
          onClick={() => setOnlyExcellent(!onlyExcellent)}
        >
          只看極品
        </button>
      </div>

      <div ref={el} className="map" />
      <button className="map-locate" onClick={locateMe} aria-label="移到我的位置">
        📍
      </button>

      {selected && (
        <div className="map-sheet">
          <div className="row" style={{ marginTop: 0, justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{selected.name}</h2>
            <button className="link small" onClick={() => setSelected(null)}>
              關閉
            </button>
          </div>
          <p className="hint" style={{ margin: "4px 0 10px" }}>
            最近 {data?.maxAgeDays} 天有 {selected.count} 台車在這裡還車
          </p>
          {METRICS.map((m) => (
            <div key={m.key} className="sheet-metric">
              <span>{m.label}</span>
              <StarDisplay value={selected.scores[m.key]} size={16} />
              <b>{selected.scores[m.key].toFixed(1)}</b>
            </div>
          ))}
          {selected.excellent.length > 0 && (
            <>
              <h2 style={{ margin: "14px 0 6px" }}>極品車</h2>
              <ul className="excellent">
                {selected.excellent.map((b) => (
                  <li key={b.id}>
                    <button className="link" onClick={() => onOpenBike(b.id)}>
                      {b.id.slice(0, 2)} {b.id.slice(2)}
                    </button>
                    <span className="hint">{timeAgo(b.at)}還到這裡</span>
                  </li>
                ))}
              </ul>
              <p className="hint" style={{ fontSize: 12 }}>
                車可能已經被騎走了，到現場看看吧
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
