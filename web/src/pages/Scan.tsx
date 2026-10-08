import { useEffect, useRef, useState } from "react";
import { recognizeBikeId, warmUpOcr } from "../ocr";

interface Props {
  onFound: (bikeId: string) => void;
}

// 對準框：寬占畫面 70%，高寬比 0.6（上下兩行車號）
const GUIDE_W = 0.7;
const GUIDE_RATIO = 0.6;
const OUT_W = 640;

export function Scan({ onFound }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    warmUpOcr().catch(() => {});
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setCamError("無法開啟相機，請允許相機權限，或改用拍照上傳 / 手動輸入。");
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  /** 把畫面上的對準框換算成影片像素座標後裁切（影片是 object-fit: cover） */
  function cropFromVideo(): HTMLCanvasElement | null {
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
    return drawCrop(v, sx, sy, sw, sh);
  }

  async function run(crop: HTMLCanvasElement | null) {
    if (!crop) return;
    setBusy(true);
    setCandidates(null);
    try {
      const ids = await recognizeBikeId(crop);
      setCandidates(ids);
    } catch {
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bmp = await createImageBitmap(file);
    // 照片取中間區域（與對準框比例相同）
    const sw = bmp.width * GUIDE_W;
    const sh = sw * GUIDE_RATIO;
    run(drawCrop(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh));
  }

  const manualValid = /^\d{7}$/.test(manual);

  return (
    <div className="page">
      <h1>掃描車號</h1>
      <p className="hint">把車號（上 2 碼、下 5 碼）對準框內再按辨識</p>

      {!camError ? (
        <div className="camera">
          <video ref={videoRef} playsInline muted />
          <div
            ref={boxRef}
            className="guide"
            style={{ width: `${GUIDE_W * 100}%`, aspectRatio: `${1 / GUIDE_RATIO}` }}
          />
        </div>
      ) : (
        <p className="error">{camError}</p>
      )}

      <div className="row">
        {!camError && (
          <button className="primary" disabled={busy} onClick={() => run(cropFromVideo())}>
            {busy ? "辨識中…" : "辨識"}
          </button>
        )}
        <label className="button">
          拍照上傳
          <input type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        </label>
      </div>

      {candidates && (
        <div className="card">
          {candidates.length === 0 ? (
            <p>沒辨識到車號，請再試一次或手動輸入。</p>
          ) : (
            <>
              <p>辨識結果（點選正確的車號）：</p>
              <div className="row wrap">
                {candidates.map((id) => (
                  <button key={id} className="chip" onClick={() => onFound(id)}>
                    {id.slice(0, 2)} {id.slice(2)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

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
    </div>
  );
}

function drawCrop(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) {
  const c = document.createElement("canvas");
  c.width = OUT_W;
  c.height = Math.round((OUT_W * sh) / sw);
  c.getContext("2d")!.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
