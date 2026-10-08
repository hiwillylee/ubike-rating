import { useEffect, useRef, useState } from "react";
// OCR（ONNX Runtime + 模型）很大，進到掃描頁才載入
const loadOcr = () => import("../ocr");

interface Props {
  onFound: (bikeId: string) => void;
}

export function Scan({ onFound }: Props) {
  const [capturing, setCapturing] = useState(false);
  const [manual, setManual] = useState("");
  const manualValid = /^\d{7}$/.test(manual);

  useEffect(() => {
    loadOcr()
      .then((m) => m.warmUpOcr())
      .catch(() => {});
  }, []);

  return (
    <div className="page">
      <h1>查詢車況</h1>
      <p className="hint">拍下車身上的車號（上 2 碼、下 5 碼），或直接輸入。</p>

      <button className="primary full scan-start" onClick={() => setCapturing(true)}>
        📷 拍攝車號
      </button>

      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          if (manualValid) onFound(manual);
        }}
      >
        <input
          inputMode="numeric"
          maxLength={7}
          placeholder="手動輸入 7 碼車號"
          value={manual}
          onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
        />
        <button type="submit" disabled={!manualValid}>
          查詢
        </button>
      </form>

      {capturing && <Capture onFound={onFound} onClose={() => setCapturing(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 全螢幕拍攝畫面（類似拍證件）：使用者移動手機把車號對進框內再按快門。
// 框外反白但看得到畫面，框內原色；只有框內會被辨識。

const GUIDE_RATIO = 0.6; // 框的高寬比（上下兩行車號）
const OUT_W = 640;

type Phase = { kind: "live" } | { kind: "busy"; shot: string } | { kind: "done"; shot: string; ids: string[] };

function Capture({ onFound, onClose }: { onFound: (id: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "live" });

  // 開啟相機；全螢幕期間鎖住背景捲動
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    document.body.style.overflow = "hidden";
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setCamError("無法開啟相機，請允許相機權限，或關閉後手動輸入車號。");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      document.body.style.overflow = "";
    };
  }, []);

  /** 把畫面上的對準框換算成影片像素座標後裁切（影片是 object-fit: cover） */
  function cropGuide(): HTMLCanvasElement | null {
    const v = videoRef.current;
    const box = boxRef.current;
    if (!v || !box || !v.videoWidth) return null;
    const vr = v.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
    const offX = (v.videoWidth * scale - vr.width) / 2;
    const offY = (v.videoHeight * scale - vr.height) / 2;
    const sx = (br.left - vr.left + offX) / scale;
    const sy = (br.top - vr.top + offY) / scale;
    const sw = br.width / scale;
    const sh = br.height / scale;
    const c = document.createElement("canvas");
    c.width = OUT_W;
    c.height = Math.round((OUT_W * sh) / sw);
    c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  async function shoot() {
    const crop = cropGuide();
    if (!crop) return;
    const shot = crop.toDataURL("image/jpeg", 0.85);
    setPhase({ kind: "busy", shot });
    let ids: string[] = [];
    try {
      const { recognizeBikeId } = await loadOcr();
      ids = await recognizeBikeId(crop);
    } catch {
      /* 當作沒辨識到 */
    }
    setPhase({ kind: "done", shot, ids });
  }

  const live = phase.kind === "live";

  return (
    <div className="capture" role="dialog" aria-label="拍攝車號">
      <video ref={videoRef} playsInline muted />

      {/* 對準框：box-shadow 把框外反白，框內維持原色 */}
      <div className="capture-center">
        <div ref={boxRef} className="capture-guide" style={{ aspectRatio: `${1 / GUIDE_RATIO}` }}>
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          {!live && <img className="capture-shot" src={phase.shot} alt="拍下的車號" />}
        </div>
        <p className="capture-tip">
          {camError ?? (live ? "請將車號對準框內" : phase.kind === "busy" ? "辨識中…" : "")}
        </p>
        {live && !camError && <p className="capture-sub">上 2 碼、下 5 碼，讓車號大致填滿框</p>}
      </div>

      <div className="capture-top">
        <button className="capture-icon" onClick={onClose} aria-label="關閉">
          ✕
        </button>
        <span>拍攝車號</span>
        <span className="capture-icon" />
      </div>

      {live ? (
        <div className="capture-bottom">
          <button className="shutter" onClick={shoot} disabled={!!camError} aria-label="拍攝並辨識" />
        </div>
      ) : (
        <div className="capture-sheet">
          {phase.kind === "busy" ? (
            <p className="hint">辨識中…（第一次需要下載辨識模型，請稍候）</p>
          ) : phase.ids.length === 0 ? (
            <p>沒辨識到車號，請重拍（靠近一點、避開反光），或關閉後手動輸入。</p>
          ) : (
            <>
              <p>辨識結果（點選正確的車號）：</p>
              <div className="row wrap">
                {phase.ids.map((id) => (
                  <button key={id} className="chip" onClick={() => onFound(id)}>
                    {id.slice(0, 2)} {id.slice(2)}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="full" onClick={() => setPhase({ kind: "live" })} disabled={phase.kind === "busy"}>
            重拍
          </button>
        </div>
      )}
    </div>
  );
}
