"use client";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  GraduationCap,
  Leaf,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  Sprout,
  Users,
  Utensils,
} from "lucide-react";
import { useApp } from "./provider";
export function Login() {
  const { mode, signIn } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await signIn(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void submit({ collegeId: f.get("collegeId"), pin: f.get("pin") });
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand light">
          <span className="brand-mark">
            <Sprout />
          </span>
          <span>
            smart<span className="brand-light">mess</span>
          </span>
        </div>
        <div className="story-body">
          <span className="eyebrow light">
            <span className="status-dot" /> A BETTER CAMPUS, ONE MEAL AT A TIME
          </span>
          <h1>
            Good food.
            <br />
            Less waste.
            <br />
            <em>Better together.</em>
          </h1>
          <p>
            From the first scan to the last plate, bring your mess community
            closer to a simpler, more thoughtful day.
          </p>
          <div className="story-steps">
            <span>
              <ScanLine size={18} /> Scan & enjoy
            </span>
            <span>
              <Leaf size={18} /> Prepare smarter
            </span>
            <span>
              <Users size={18} /> Stay connected
            </span>
          </div>
        </div>
        <div className="story-footer">
          <span className="story-icon">
            <Utensils size={20} />
          </span>
          <span>
            Built for your campus.<small>Starting with South Mess.</small>
          </span>
          <span className="story-leaf">
            <Leaf size={80} />
          </span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">WELCOME TO SMART MESS</span>
          <h2>
            Your next meal,
            <br />a little simpler.
          </h2>
          <p className="muted">
            {mode === "demo"
              ? "Explore the student experience or take a look around the manager workspace."
              : "Sign in with your college ID and your assigned PIN."}
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {mode === "demo" ? (
            <div className="demo-choices">
              <button
                className="role-card"
                disabled={busy}
                onClick={() => submit({ role: "student" })}
              >
                <span className="role-icon">
                  <GraduationCap />
                </span>
                <span>
                  <strong>I’m a student</strong>
                  <small>Scan a meal, check your balance and history</small>
                </span>
                <ArrowRight size={20} />
              </button>
              <button
                className="role-card manager"
                disabled={busy}
                onClick={() => submit({ role: "manager" })}
              >
                <span className="role-icon">
                  <Utensils />
                </span>
                <span>
                  <strong>I manage the mess</strong>
                  <small>Live counts, forecasts, accounts and reports</small>
                </span>
                <ArrowRight size={20} />
              </button>
              <div className="demo-disclosure">
                <ShieldCheck size={18} />
                <span>
                  <strong>Demo mode — no real accounts</strong>
                  <small>
                    All data is synthetic and stays in this browser. Camera
                    access is optional.
                  </small>
                </span>
              </div>
            </div>
          ) : (
            <form onSubmit={login} className="form-stack">
              <label>
                College ID
                <input
                  name="collegeId"
                  autoComplete="username"
                  required
                  maxLength={40}
                  placeholder="Enter your college ID"
                />
              </label>
              <label>
                PIN
                <div className="input-icon">
                  <LockKeyhole size={17} />
                  <input
                    name="pin"
                    type="password"
                    autoComplete="current-password"
                    inputMode="numeric"
                    pattern="[0-9]{6,12}"
                    minLength={6}
                    maxLength={12}
                    required
                    placeholder="Your 6–12 digit PIN"
                  />
                </div>
              </label>
              <button className="button primary full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in securely"}
                <ArrowRight size={17} />
              </button>
              <p className="small muted">
                Need an account or a PIN reset? Contact the hostel office.
              </p>
            </form>
          )}
          <div className="login-assurance">
            <Check size={15} /> Student scans. Staff checks. Meal recorded.
          </div>
        </div>
        <div className="login-bottom">
          Smart Mess <span>Meal care, made clearer.</span>
        </div>
      </section>
    </div>
  );
}
