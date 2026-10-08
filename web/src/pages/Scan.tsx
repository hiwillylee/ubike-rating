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
          placeholder="或手動輸入 7 碼車號"
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

// iOS Safari 每次呼叫 getUserMedia 都可能重新詢問權限，所以關閉拍攝畫面後先保留相機一段時間，
// 期間再打開就直接沿用；離開頁面時立即釋放。
const KEEP_CAMERA_MS = 2 * 60 * 1000;
let sharedStream: MediaStream | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function stopCamera() {
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
}

async function acquireCamera(): Promise<MediaStream> {
  clearTimeout(releaseTimer);
  if (sharedStream?.getVideoTracks().some((t) => t.readyState === "live")) return sharedStream;
  sharedStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1920 } },
    audio: false,
  });
  return sharedStream;
}

function releaseCameraLater() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(stopCamera, KEEP_CAMERA_MS);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", stopCamera);
const OUT_W = 640;

type Phase = { kind: "live" } | { kind: "busy"; shot: string } | { kind: "done"; shot: string; ids: string[] };

function Capture({ onFound, onClose }: { onFound: (id: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "live" });

  // 開啟相機；全螢幕期間鎖住背景捲動
  useEffect(() => {
    let cancelled = false;
    document.body.style.overflow = "hidden";
    (async () => {
      try {
        const stream = await acquireCamera();
        if (cancelled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setCamError("開不了相機，請允許相機權限");
      }
    })();
    return () => {
      cancelled = true;
      releaseCameraLater();
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
          {camError ?? (live ? "請將車號對準框內" : phase.kind === "busy" ? "辨識中，稍等一下…" : "")}
        </p>
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
            <p className="hint">辨識中，稍等一下…</p>
          ) : phase.ids.length === 0 ? (
            <p>沒認出來，靠近點再拍一次</p>
          ) : (
            <>
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
