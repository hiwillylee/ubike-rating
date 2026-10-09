import { useEffect, useState } from "react";
import {
  ApiError,
  getBike,
  nearestStation,
  rateBike,
  type BikeInfo,
  type NearStation,
  type Position,
} from "../api";
import { currentEmail } from "../auth";
import { METRICS, type MetricKey, type Scores } from "../config";
import { getPosition, timeAgo } from "../geo";
import { StarDisplay, StarInput } from "../Stars";

type Locating =
  { state: "idle" } | { state: "locating" } | { state: "done"; pos: Position | null; station: NearStation };

interface Props {
  bikeId: string;
  onNeedLogin: () => void;
  onBack: () => void;
}

export function Bike({ bikeId, onNeedLogin, onBack }: Props) {
  const [info, setInfo] = useState<BikeInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Scores>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loc, setLoc] = useState<Locating>({ state: "idle" });

  // 開始評分時才定位（還車時評分，就能記下是哪一站）
  async function locate() {
    setLoc({ state: "locating" });
    const pos = await getPosition();
    const station = pos
      ? await nearestStation(pos)
          .then((r) => r.station)
          .catch(() => null)
      : null;
    setLoc({ state: "done", pos, station });
  }

  useEffect(() => {
    setInfo(null);
    setLoadError(null);
    getBike(bikeId)
      .then(setInfo)
      .catch((e: ApiError) => setLoadError(e.message));
  }, [bikeId]);

  const complete = METRICS.every((m) => form[m.key]);

  async function submit() {
    if (!complete) return;
    if (!currentEmail()) return onNeedLogin();
    setSubmitting(true);
    setMessage(null);
    try {
      const pos = loc.state === "done" ? loc.pos : null;
      const updated = await rateBike(bikeId, form as Scores, pos);
      setInfo(updated);
      setForm({});
      setMessage({
        ok: true,
        text: updated.station ? `已送出，記在${updated.station.name}，謝謝！` : "已送出，謝謝！",
      });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) return onNeedLogin();
      setMessage({ ok: false, text: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <button className="link" onClick={onBack}>
        ← 重新掃描
      </button>
      <h1 className="bike-id">
        {bikeId.slice(0, 2)} <span>{bikeId.slice(2)}</span>
      </h1>
      {info?.location && (
        <p className="hint">
          📍 上次在{info.location.station.name}還車 · {timeAgo(info.location.at)}
        </p>
      )}

      <section className="card">
        <h2>目前車況</h2>
        {loadError && <p className="error">{loadError}</p>}
        {!info && !loadError && <p className="hint">載入中…</p>}
        {info && !info.scores && <p className="hint">還沒人評分，來當第一個吧</p>}
        {info?.scores && (
          <>
            {METRICS.map((m) => {
              const v = info.scores![m.key as MetricKey];
              return (
                <div key={m.key} className="metric">
                  <span className="metric-label">{m.label}</span>
                  <StarDisplay value={v} size={22} />
                  <span className="metric-value">
                    {v.toFixed(1)} · {m.levels[Math.round(v) - 1]}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </section>

      <section className="card">
        <h2>我要評分</h2>
        {METRICS.map((m) => {
          const v = form[m.key];
          return (
            <div key={m.key} className="rate-row">
              <div className="rate-label">{m.label}</div>
              <StarInput
                value={v}
                labels={m.levels}
                onChange={(n) => {
                  if (loc.state === "idle") locate();
                  setForm({ ...form, [m.key]: n });
                }}
              />
              {v && <div className="rate-level">{m.levels[v - 1]}</div>}
            </div>
          );
        })}
        {loc.state !== "idle" && (
          <p className="hint station-line">
            {loc.state === "locating"
              ? "📍 找找你在哪一站…"
              : loc.station
                ? `📍 還車站：${loc.station.name}`
                : loc.pos
                  ? "📍 附近沒有站點，分數照樣記錄"
                  : "📍 沒拿到定位，分數照樣記錄"}
          </p>
        )}
        {message && <p className={message.ok ? "success" : "error"}>{message.text}</p>}
        <button
          className="primary full"
          disabled={!complete || submitting || loc.state === "locating"}
          onClick={submit}
        >
          {submitting ? "送出中…" : currentEmail() ? "送出評分" : "登入後送出"}
        </button>
      </section>

      {info && info.recent.length > 0 && (
        <section className="card">
          <h2>最近紀錄</h2>
          <table className="recent">
            <thead>
              <tr>
                <th>時間</th>
                {METRICS.map((m) => (
                  <th key={m.key}>{m.label.slice(0, 3)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {info.recent.map((r) => (
                <tr key={r.at}>
                  <td>
                    {new Date(r.at).toLocaleString("zh-TW", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  {METRICS.map((m) => (
                    <td key={m.key}>
                      <StarDisplay value={r[m.key]} size={12} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
