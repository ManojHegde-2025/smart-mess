"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coffee,
  History,
  Plus,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sun,
  Sunset,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import type { Html5Qrcode } from "html5-qrcode";
import { useApp } from "./provider";
import { Empty, ErrorBox, Loading, Shell } from "./shell";
import { currentMeal, formatMoney } from "@/lib/domain";
import { demoQr } from "@/lib/demo";
import {
  MEALS,
  type Meal,
  type ScanResult,
  type StudentOverview,
} from "@/lib/types";
const icons = { breakfast: Coffee, lunch: Sun, dinner: Sunset };

function Scanner({
  onScan,
  onClose,
}: {
  onScan: (token: string) => Promise<void>;
  onClose: () => void;
}) {
  const scanner = useRef<Html5Qrcode | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const consumed = useRef(false);
  const mounted = useRef(true);
  const pendingStart = useRef<Promise<void> | null>(null);
  const closing = useRef(false);
  const [closingView, setClosingView] = useState(false);
  const cleanup = useCallback(async () => {
    const instance = scanner.current;
    scanner.current = null;
    if (instance) {
      try {
        await instance.stop();
      } catch {
        /* It may still be starting or already stopped. */
      }
      try {
        instance.clear();
      } catch {
        /* The pending start handles its own cancellation. */
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void cleanup();
    };
  }, [cleanup]);
  async function accept(text: string) {
    if (consumed.current || closing.current) return;
    consumed.current = true;
    setBusy(true);
    await cleanup();
    try {
      await onScan(text);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
      consumed.current = false;
    } finally {
      if (mounted.current) {
        setBusy(false);
        setActive(false);
      }
    }
  }
  async function close() {
    closing.current = true;
    setClosingView(true);
    await pendingStart.current;
    await cleanup();
    onClose();
  }
  function begin() {
    const task = start();
    pendingStart.current = task;
    void task.finally(() => {
      pendingStart.current = null;
    });
  }
  async function settleVideo() {
    const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
    if (!video) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        video.removeEventListener("playing", finish);
        video.removeEventListener("error", finish);
        resolve();
      };
      const timer = setTimeout(finish, 2500);
      if (video.readyState >= 3 && !video.paused) finish();
      else {
        video.addEventListener("playing", finish, { once: true });
        video.addEventListener("error", finish, { once: true });
      }
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  async function start() {
    setError("");
    setBusy(true);
    let instance: Html5Qrcode | null = null;
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!mounted.current) return;
      await cleanup();
      instance = new Html5Qrcode("qr-reader");
      scanner.current = instance;
      await instance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (text) => {
          if (mounted.current) void accept(text);
        },
        () => {},
      );
      if (!mounted.current) {
        await instance.stop();
        instance.clear();
        return;
      }
      await settleVideo();
      if (mounted.current) setActive(true);
    } catch {
      if (instance)
        try {
          await instance.stop();
        } catch {}
      if (mounted.current)
        setError(
          "Camera unavailable. Allow camera access over HTTPS, upload a QR image, or paste the counter token.",
        );
      await cleanup();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function upload(file: File) {
    setError("");
    setBusy(true);
    try {
      await cleanup();
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!mounted.current) return;
      const instance = new Html5Qrcode("qr-reader");
      scanner.current = instance;
      const text = await instance.scanFile(file, true);
      if (mounted.current) await accept(text);
    } catch {
      if (mounted.current)
        setError("No readable QR found in that image. Try a clearer image.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Scan counter QR"
      >
        <button
          className="modal-close icon-button"
          onClick={() => void close()}
          disabled={closingView}
          aria-label="Close scanner"
        >
          <X />
        </button>
        <span className="section-icon">
          <ScanLine />
        </span>
        <h2>Scan the counter QR</h2>
        <p className="muted">
          Point your camera at the current QR displayed in your mess.
        </p>
        <div id="qr-reader" className="camera-frame" />
        {closingView && (
          <p role="status">
            Closing camera… If a permission prompt is open, dismiss it to
            finish.
          </p>
        )}
        {error && <ErrorBox message={error} />}
        {!active && (
          <button
            className="button primary full"
            onClick={begin}
            disabled={busy || closingView}
          >
            <Camera size={18} />
            Open camera
          </button>
        )}
        <label className="button secondary full upload-button">
          Upload QR image
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.[0]) void upload(e.target.files[0]);
            }}
          />
        </label>
        <details className="manual-entry">
          <summary>Paste a counter token instead</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void accept(String(form.get("token")));
            }}
          >
            <textarea
              name="token"
              required
              rows={3}
              maxLength={4096}
              placeholder="Paste the current QR token"
            />
            <button className="button secondary full" disabled={busy}>
              Validate token
            </button>
          </form>
        </details>
        <p className="small muted">
          The camera feed stays on your device. Only the decoded token is
          submitted.
        </p>
      </section>
    </div>
  );
}
function Result({
  result,
  onClose,
}: {
  result: ScanResult;
  onClose: () => void;
}) {
  const [seconds, setSeconds] = useState(60);
  useEffect(() => {
    const update = () =>
      setSeconds(
        Math.max(
          0,
          60 - Math.floor((Date.now() - Date.parse(result.scannedAt)) / 1000),
        ),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [result.scannedAt]);
  const valid = result.accepted && seconds > 0;
  return (
    <div className="modal-backdrop">
      <section
        className={`result-card ${valid ? "valid" : "invalid"}`}
        role="dialog"
        aria-modal="true"
        aria-label="Meal scan result"
      >
        <button
          className="result-close"
          onClick={onClose}
          aria-label="Close result"
        >
          <X />
        </button>
        {valid ? <CheckCircle2 size={76} /> : <XCircle size={76} />}
        <span className="eyebrow">{result.messName}</span>
        <h2>
          {valid
            ? "Enjoy your meal!"
            : result.accepted
              ? "Receipt expired"
              : "Meal not allowed"}
        </h2>
        <p>
          {result.accepted && seconds === 0
            ? "Your meal is already recorded. Open your history for the receipt."
            : result.message}
        </p>
        <div className="result-person">
          <strong>{result.name}</strong>
          <span>
            {result.meal} ·{" "}
            {new Date(result.scannedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
        {result.warning && <p className="result-warning">{result.warning}</p>}
        <p className="result-timer">
          {valid
            ? `Show this screen to staff · ${seconds}s remaining`
            : result.reason.replaceAll("_", " ")}
        </p>
        <button className="button white full" onClick={onClose}>
          Back to my meals
        </button>
      </section>
    </div>
  );
}
export function Student() {
  const { api, user, ready, mode } = useApp();
  const [data, setData] = useState<StudentOverview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"meals" | "ledger" | "leave">("meals");
  const [requestLeaveModal, setRequestLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    startsOn: "",
    endsOn: "",
    reason: "",
  });
  const load = useCallback(async () => {
    try {
      setData(await api<StudentOverview>("/student/overview"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load account.");
    }
  }, [api]);
  useEffect(() => {
    if (ready && user?.role === "student") void load();
  }, [ready, user, load]);
  async function scan(token: string) {
    const receipt = await api<ScanResult>("/meals/scan", "POST", { token });
    setResult(receipt);
    await load();
  }
  async function sample() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await scan(demoQr(currentMeal(data.settings)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setBusy(false);
    }
  }
  async function addon(addonId: string) {
    setBusy(true);
    setNotice("");
    try {
      await api("/addons", "POST", {
        addonId,
        quantity: 1,
        requestId: crypto.randomUUID(),
      });
      setNotice(
        "Add-on recorded in your account. Collect it from the counter.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add item.");
    } finally {
      setBusy(false);
    }
  }
  async function handleSubmitLeave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/student/leaves", "POST", {
        startsOn: leaveForm.startsOn,
        endsOn: leaveForm.endsOn,
        reason: leaveForm.reason.trim() || undefined,
      });
      setNotice("Leave request submitted successfully for manager review.");
      setRequestLeaveModal(false);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit leave request.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function handleCancelLeave(leaveId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/student/leaves/cancel", "POST", { leaveId });
      setNotice("Leave request cancelled.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel leave request.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell role="student">
      {error && <ErrorBox message={error} retry={() => void load()} />}{" "}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR CAMPUS, YOUR COMMUNITY</span>
              <h1>
                Hello, {data.user.name.split(" ")[0]}
                <span className="hello-dot">.</span>
              </h1>
              <p>Good food and one less thing to worry about.</p>
            </div>
            <span className="date-chip">
              <Clock3 size={16} />
              {data.today} · {data.settings.messName}
            </span>
          </div>
          <div className="student-top">
            <section className="scan-hero">
              <div className="scan-hero-content">
                <span className="eyebrow light">READY WHEN YOU ARE</span>
                <h2>
                  A quick scan.
                  <br />A warm meal.
                </h2>
                <p>
                  Scan the QR at the counter, show your result to the staff, and
                  enjoy.
                </p>
                <button
                  className="button white"
                  onClick={() => setScanning(true)}
                >
                  <ScanLine size={19} />
                  Scan meal QR
                  <ChevronRight size={18} />
                </button>
                {mode === "demo" && (
                  <button
                    className="demo-scan"
                    disabled={busy}
                    onClick={sample}
                  >
                    Try a sample scan <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
              <div className="scan-art" aria-hidden="true">
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
                <div className="qr-art">
                  <QrCode size={96} strokeWidth={1.4} />
                  <span>
                    <Check size={15} />
                    Meal verified
                  </span>
                </div>
              </div>
            </section>
            <section className="balance-card">
              <span className="card-label">
                <Wallet size={18} />
                MY MESS BALANCE
              </span>
              <h2 className={data.balance < 0 ? "negative" : ""}>
                {formatMoney(data.balance)}
              </h2>
              <span className={`badge ${data.balance < 0 ? "amber" : "green"}`}>
                {data.balance < 0 ? "Amount due" : "Available credit"}
              </span>
              <p>
                {data.balance < 0
                  ? "Please settle with the office. A negative balance alone does not block meals."
                  : "Meals and add-ons are recorded automatically. Contact the office for credits or corrections."}
              </p>
              <div className="balance-footer">
                <ShieldCheck size={16} />
                Every change has a ledger entry.
              </div>
            </section>
          </div>
          {!data.settings.configured && (
            <div className="alert warning">
              The office must confirm meal timings and prices before live scans
              can begin.
            </div>
          )}
          <div className="section-heading">
            <div>
              <h2>Today’s menu of moments</h2>
              <p>Your meal status and service windows.</p>
            </div>
            <button className="text-button" onClick={() => void load()}>
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
          <div className="meal-grid">
            {MEALS.map((meal) => {
              const Icon = icons[meal];
              const eaten = data.events.some(
                (e) =>
                  e.meal === meal &&
                  e.serviceDate === data.today &&
                  e.decision === "accepted",
              );
              return (
                <section className="meal-card" key={meal}>
                  <div className={`meal-icon ${meal}`}>
                    <Icon size={24} />
                  </div>
                  <div>
                    <h3 className="capitalize">{meal}</h3>
                    <p>
                      <Clock3 size={12} />
                      {data.settings.windows[meal].start}–
                      {data.settings.windows[meal].end}
                    </p>
                  </div>
                  <div className="meal-card-end">
                    <strong>{formatMoney(data.settings.prices[meal])}</strong>
                    <span className={`badge ${eaten ? "green" : "neutral"}`}>
                      {eaten ? "Recorded" : "Not recorded"}
                    </span>
                  </div>
                </section>
              );
            })}
          </div>
          <div className="student-lower">
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <History size={18} />
                  Your account activity
                </h2>
              </div>
              <div className="tabs">
                {(["meals", "ledger", "leave"] as const).map((t) => (
                  <button
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                    key={t}
                  >
                    {t === "meals"
                      ? "Meal history"
                      : t === "ledger"
                        ? "Balance ledger"
                        : "Leave status"}
                  </button>
                ))}
              </div>
              {tab === "meals" ? (
                data.events.length ? (
                  <div className="activity-list">
                    {data.events.slice(0, 15).map((e) => (
                      <div className="activity-row" key={e.id}>
                        <span
                          className={`activity-icon ${e.decision === "accepted" ? "green" : "red"}`}
                        >
                          {e.decision === "accepted" ? (
                            <Check size={16} />
                          ) : (
                            <X size={16} />
                          )}
                        </span>
                        <div>
                          <strong className="capitalize">{e.meal}</strong>
                          <small>
                            {e.serviceDate} ·{" "}
                            {e.reason.replaceAll("_", " ").toLowerCase()}
                          </small>
                        </div>
                        <span
                          className={`badge ${e.decision === "accepted" ? "green" : "red"}`}
                        >
                          {e.decision === "accepted" ? "Recorded" : "Rejected"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>
                    Your first meal will appear here after you scan.
                  </Empty>
                )
              ) : tab === "ledger" ? (
                data.ledger.length ? (
                  <div className="activity-list">
                    {data.ledger.slice(0, 20).map((e) => (
                      <div className="activity-row" key={e.id}>
                        <span className="activity-icon">
                          {e.amount >= 0 ? (
                            <ArrowDownLeft size={16} />
                          ) : (
                            <ArrowUpRight size={16} />
                          )}
                        </span>
                        <div>
                          <strong>{e.note}</strong>
                          <small>
                            {new Date(e.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                        <strong className={e.amount >= 0 ? "positive" : ""}>
                          {e.amount >= 0 ? "+" : ""}
                          {formatMoney(e.amount)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>Your credits and meal charges will appear here.</Empty>
                )
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "12px",
                      marginTop: "4px",
                    }}
                  >
                    <span className="small muted">
                      Approved leaves adjust your meal forecast and scan status.
                    </span>
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() => {
                        setLeaveForm({
                          startsOn: data.today,
                          endsOn: data.today,
                          reason: "",
                        });
                        setRequestLeaveModal(true);
                      }}
                    >
                      <Plus size={14} /> Request leave
                    </button>
                  </div>
                  {data.leaves.length ? (
                    <div className="activity-list">
                      {data.leaves.map((l) => (
                        <div className="activity-row" key={l.id}>
                          <span className="activity-icon">
                            <Clock3 size={16} />
                          </span>
                          <div>
                            <strong>
                              {l.startsOn} → {l.endsOn}
                            </strong>
                            <small>
                              {l.reason ? `${l.reason} · ` : ""}
                              {l.source === "student_request"
                                ? "Your request"
                                : l.source === "manager_manual"
                                  ? "Manager sanctioned"
                                  : `From ${l.source}`}
                            </small>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span
                              className={`badge ${
                                l.status === "approved"
                                  ? "green"
                                  : l.status === "pending"
                                    ? "amber"
                                    : l.status === "rejected"
                                      ? "red"
                                      : "neutral"
                              }`}
                            >
                              {l.status === "pending"
                                ? "Pending review"
                                : l.status}
                            </span>
                            {l.status === "pending" && (
                              <button
                                type="button"
                                className="text-button"
                                style={{
                                  color: "#e86550",
                                  fontSize: "12px",
                                }}
                                disabled={busy}
                                onClick={() => handleCancelLeave(l.id)}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>
                      No leave records. Request leave using the button above or
                      apply through your hostel warden.
                    </Empty>
                  )}
                </>
              )}
            </section>
            <section className="panel addons-panel">
              <div className="panel-heading">
                <h2>A little extra</h2>
                <span className="badge neutral">Add-ons</span>
              </div>
              <p className="muted">
                Pick up an extra at the counter. The charge goes straight to
                your ledger.
              </p>
              {notice && (
                <div className="alert success" role="status">
                  {notice}
                </div>
              )}
              {data.settings.addons.map((item) => (
                <div className="addon-row" key={item.id}>
                  <span className="addon-emoji" aria-hidden="true">
                    {item.id === "milk" ? "🥛" : "🥚"}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{formatMoney(item.price)} per item</small>
                  </span>
                  <button
                    className="icon-button add-button"
                    aria-label={`Add ${item.name}`}
                    disabled={busy || !data.settings.configured}
                    onClick={() => void addon(item.id)}
                  >
                    <Plus size={18} />
                  </button>
                </div>
              ))}
              <div className="info-note">
                <ShieldCheck size={18} />
                <p>
                  Questions about a charge? The hostel office can add an audited
                  correction.
                </p>
              </div>
            </section>
          </div>
          {scanning && (
            <Scanner onScan={scan} onClose={() => setScanning(false)} />
          )}{" "}
          {result && <Result result={result} onClose={() => setResult(null)} />}
          {requestLeaveModal && (
            <div
              className="modal-backdrop"
              onClick={() => setRequestLeaveModal(false)}
            >
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <button
                  className="modal-close"
                  onClick={() => setRequestLeaveModal(false)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
                <div className="section-icon">
                  <Clock3 size={24} />
                </div>
                <h2>Request mess leave</h2>
                <p>
                  Notify the mess management of planned absences to help reduce
                  food waste.
                </p>
                <form onSubmit={handleSubmitLeave} className="form-stack">
                  <label>
                    Leave begins on (YYYY-MM-DD)
                    <input
                      required
                      type="date"
                      min={data.today}
                      value={leaveForm.startsOn}
                      onChange={(e) =>
                        setLeaveForm({ ...leaveForm, startsOn: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Leave ends on (YYYY-MM-DD)
                    <input
                      required
                      type="date"
                      min={leaveForm.startsOn || data.today}
                      value={leaveForm.endsOn}
                      onChange={(e) =>
                        setLeaveForm({ ...leaveForm, endsOn: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Reason (optional)
                    <textarea
                      rows={2}
                      maxLength={300}
                      placeholder="e.g. Visiting hometown, attending seminar"
                      value={leaveForm.reason}
                      onChange={(e) =>
                        setLeaveForm({ ...leaveForm, reason: e.target.value })
                      }
                    />
                  </label>
                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      marginTop: "12px",
                    }}
                  >
                    <button
                      type="button"
                      className="button secondary full"
                      onClick={() => setRequestLeaveModal(false)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button className="button primary full" disabled={busy}>
                      {busy ? "Submitting…" : "Submit leave request"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
