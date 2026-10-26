"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Clock3, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { useApp } from "./provider";
import { ErrorBox, Shell } from "./shell";
import { MEALS, type Meal } from "@/lib/types";
type Token = {
  token: string;
  meal: Meal;
  date: string;
  messName: string;
  expiresAt: string;
};
export function Counter() {
  const { api, user, ready, mode } = useApp();
  const [meal, setMeal] = useState<Meal>("lunch");
  const [token, setToken] = useState<Token | null>(null);
  const [image, setImage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await api<Token>(`/manager/qr?meal=${meal}`);
      const image = await QRCode.toDataURL(result.token, {
        width: 360,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#1a1a1e", light: "#e8e6e3" },
      });
      if (request !== generation.current) return;
      setToken(result);
      setImage(image);
      setError("");
    } catch (e) {
      if (request !== generation.current) return;
      setError(e instanceof Error ? e.message : "Unable to create QR.");
      setToken(null);
      setImage("");
    }
  }, [api, meal]);
  useEffect(() => {
    if (ready && user?.role === "manager") {
      void refresh();
      const timer = setInterval(() => void refresh(), 30000);
      return () => {
        generation.current++;
        clearInterval(timer);
      };
    }
  }, [ready, user, refresh]);
  useEffect(() => {
    const update = () =>
      setSeconds(
        token
          ? Math.max(
              0,
              Math.ceil((Date.parse(token.expiresAt) - Date.now()) / 1000),
            )
          : 0,
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [token]);
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SELF-SERVICE MEAL VERIFICATION</span>
          <h1>Scan here. Enjoy your meal.</h1>
          <p>
            Display this page at the mess counter. Students scan with their own
            phones.
          </p>
        </div>
      </div>
      <section className="counter-panel">
        <div className="counter-heading">
          <span className="section-icon">
            <ScanLine size={26} />
          </span>
          <h2>{token?.messName ?? "South Mess"}</h2>
          <div className="segmented">
            {MEALS.map((m) => (
              <button
                className={meal === m ? "active" : ""}
                onClick={() => {
                  setMeal(m);
                  setImage("");
                  setToken(null);
                }}
                key={m}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {error && <ErrorBox message={error} retry={() => void refresh()} />}
        <div className="counter-qr">
          {image && seconds > 0 ? (
            <img
              src={image}
              width={320}
              height={320}
              alt={`Current ${meal} QR token`}
            />
          ) : (
            <div className="qr-placeholder">
              <RefreshCw size={40} />
              <p>Waiting for a valid QR…</p>
            </div>
          )}
        </div>
        <div className="qr-expiry">
          <span className="status-dot" />
          <Clock3 size={15} />
          {seconds > 0
            ? `Refreshes automatically · valid for ${seconds}s`
            : "QR unavailable — do not scan"}
        </div>
        <div className="counter-steps">
          <span>
            <b>1</b>Open your student account
          </span>
          <span>
            <b>2</b>Scan the QR
          </span>
          <span>
            <b>3</b>Show green to the staff
          </span>
        </div>
        <p className="small muted">
          <ShieldCheck size={14} />
          Each student can record one meal per service period.
        </p>
        {mode === "demo" && (
          <p className="demo-disclosure">
            Demo QR works within demo mode only. Live mode signs each QR on the
            server.
          </p>
        )}
      </section>
    </Shell>
  );
}
