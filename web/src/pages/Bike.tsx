import { useEffect, useState } from "react";
import { ApiError, getBike, rateBike, type BikeInfo } from "../api";
import { currentEmail } from "../auth";
import { METRICS, type MetricKey, type Scores } from "../config";

interface Props {
  bikeId: string;
  onNeedLogin: () => void;
  onBack: () => void;
}

const levelClass = (v: number) => (v >= 3.5 ? "good" : v >= 2.5 ? "ok" : v >= 1.5 ? "warn" : "bad");

export function Bike({ bikeId, onNeedLogin, onBack }: Props) {
  const [info, setInfo] = useState<BikeInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Scores>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

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
      const updated = await rateBike(bikeId, form as Scores);
      setInfo(updated);
      setForm({});
      setMessage({ ok: true, text: "已送出，感謝回報！" });
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

      <section className="card">
        <h2>目前車況</h2>
        {loadError && <p className="error">{loadError}</p>}
        {!info && !loadError && <p className="hint">載入中…</p>}
        {info && !info.scores && <p className="hint">這台車還沒有人評分，來當第一個吧！</p>}
        {info?.scores && (
          <>
            {METRICS.map((m) => {
              const v = info.scores![m.key as MetricKey];
              return (
                <div key={m.key} className="metric">
                  <div className="metric-head">
                    <span>{m.label}</span>
                    <strong className={levelClass(v)}>
                      {v.toFixed(1)} · {m.levels[Math.round(v) - 1]}
                    </strong>
                  </div>
                  <div className="bar">
                    <div className={`fill ${levelClass(v)}`} style={{ width: `${(v / 4) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            <p className="hint">依最新 {info.count} 筆評分加權計算（越新權重越高）</p>
          </>
        )}
      </section>

      <section className="card">
        <h2>我要評分</h2>
        {METRICS.map((m) => (
          <div key={m.key} className="rate-row">
            <div className="rate-label">{m.label}</div>
            <div className="levels">
              {m.levels.map((label, i) => (
                <button
                  key={label}
                  className={form[m.key] === i + 1 ? `level selected ${levelClass(i + 1)}` : "level"}
                  onClick={() => setForm({ ...form, [m.key]: i + 1 })}
                >
                  <b>{i + 1}</b>
                  <small>{label}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
        {message && <p className={message.ok ? "success" : "error"}>{message.text}</p>}
        <button className="primary full" disabled={!complete || submitting} onClick={submit}>
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
                  <td>{new Date(r.at).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}</td>
                  {METRICS.map((m) => (
                    <td key={m.key} className={levelClass(r[m.key])}>
                      {r[m.key]}
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
