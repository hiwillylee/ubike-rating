import { useState } from "react";
import { AuthError, confirmSignUp, resendCode, signIn, signUp } from "../auth";

type Mode = "signin" | "signup" | "confirm";

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      const err = e as AuthError;
      if (err.code === "UserNotConfirmedException") {
        setMode("confirm");
        setInfo("請輸入 Email 收到的驗證碼");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signin") act(async () => (await signIn(email, password), onDone()));
    if (mode === "signup")
      act(async () => {
        await signUp(email, password);
        setMode("confirm");
        setInfo("驗證碼已寄到你的 Email");
      });
    if (mode === "confirm")
      act(async () => {
        await confirmSignUp(email, code);
        await signIn(email, password);
        onDone();
      });
  };

  return (
    <div className="page">
      <button className="link" onClick={onDone}>
        ← 返回
      </button>
      <h1>{mode === "signin" ? "登入" : mode === "signup" ? "註冊" : "驗證 Email"}</h1>
      <p className="hint">評分需要登入，查詢車況不用。</p>

      <form className="card form" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            disabled={mode === "confirm"}
          />
        </label>
        <label>
          密碼
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === "signup" && <p className="hint">至少 8 碼，需包含數字</p>}
        {mode === "confirm" && (
          <label>
            驗證碼
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
            />
          </label>
        )}

        {info && <p className="success">{info}</p>}
        {error && <p className="error">{error}</p>}

        <button className="primary full" disabled={busy}>
          {busy ? "處理中…" : mode === "signin" ? "登入" : mode === "signup" ? "註冊" : "驗證並登入"}
        </button>
      </form>

      <div className="row center">
        {mode === "signin" && (
          <button className="link" onClick={() => setMode("signup")}>
            還沒有帳號？註冊
          </button>
        )}
        {mode === "signup" && (
          <button className="link" onClick={() => setMode("signin")}>
            已有帳號？登入
          </button>
        )}
        {mode === "confirm" && (
          <button
            className="link"
            disabled={busy}
            onClick={() => act(async () => (await resendCode(email), setInfo("已重新寄送驗證碼")))}
          >
            重新寄送驗證碼
          </button>
        )}
      </div>
    </div>
  );
}
