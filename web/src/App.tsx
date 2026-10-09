import { lazy, Suspense, useEffect, useState } from "react";
import { currentEmail, onAuthChange, signOut } from "./auth";
import { Bike } from "./pages/Bike";
import { Login } from "./pages/Login";
import { Scan } from "./pages/Scan";

// 地圖套件只在打開地圖時載入
const MapPage = lazy(() => import("./pages/Map").then((m) => ({ default: m.MapPage })));

// 簡單的 hash 路由：#/、#/bike/1234567、#/login
const readRoute = () => location.hash.replace(/^#/, "") || "/";

export function App() {
  const [route, setRoute] = useState(readRoute);
  const [email, setEmail] = useState(currentEmail);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    const off = onAuthChange(() => setEmail(currentEmail()));
    return () => {
      window.removeEventListener("hashchange", onHash);
      off();
    };
  }, []);

  const go = (r: string) => (location.hash = r);
  const bikeMatch = route.match(/^\/bike\/(\d{7})$/);

  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          🚲 單車車況
        </a>
        <span className="topbar-actions">
          {route !== "/map" && (
            <a href="#/map" className="link small">
              🗺️ 地圖
            </a>
          )}
          {email ? (
            <button className="link small" onClick={signOut} title={email}>
              登出
            </button>
          ) : (
            route !== "/login" && (
              <button className="link small" onClick={() => go("/login")}>
                登入
              </button>
            )
          )}
        </span>
      </header>
      <main className={route === "/map" ? "wide" : undefined}>
        {route === "/map" ? (
          <Suspense fallback={<p className="hint page">載入地圖…</p>}>
            <MapPage onOpenBike={(id) => go(`/bike/${id}`)} />
          </Suspense>
        ) : route === "/login" ? (
          <Login onDone={() => history.back()} />
        ) : bikeMatch ? (
          <Bike bikeId={bikeMatch[1]} onNeedLogin={() => go("/login")} onBack={() => go("/")} />
        ) : (
          <Scan onFound={(id) => go(`/bike/${id}`)} />
        )}
      </main>
    </>
  );
}
