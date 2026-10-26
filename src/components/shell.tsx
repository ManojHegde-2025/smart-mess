"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  QrCode,
  Settings2,
  ShieldCheck,
  Sprout,
  Users,
  Utensils,
  X,
  Menu,
} from "lucide-react";
import { useApp } from "./provider";
import type { Role } from "@/lib/types";

export function Shell({
  children,
  role = "manager",
}: {
  children: ReactNode;
  role?: Role;
}) {
  const { user, ready, mode, signOut, reset } = useApp();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (ready && !user) router.replace("/login");
    else if (ready && user && user.role !== role)
      router.replace(user.role === "manager" ? "/manager" : "/student");
  }, [ready, user, role, router]);
  if (!ready || !user || user.role !== role)
    return (
      <div className="page-loading">
        <Sprout size={36} />
        <p>Opening your workspace…</p>
      </div>
    );
  const links =
    role === "manager"
      ? [
          { href: "/manager", label: "Overview", icon: LayoutDashboard },
          { href: "/manager/accounts", label: "Student accounts", icon: Users },
          {
            href: "/manager/reports",
            label: "Reports & activity",
            icon: BarChart3,
          },
          {
            href: "/manager/settings",
            label: "Mess settings",
            icon: Settings2,
          },
          { href: "/display", label: "Counter QR", icon: QrCode },
        ]
      : [{ href: "/student", label: "My meals & account", icon: Utensils }];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link
          className="brand"
          href={role === "manager" ? "/manager" : "/student"}
        >
          <span className="brand-mark">
            <Sprout size={24} />
          </span>
          <span>
            smart<span className="brand-light">mess</span>
            <small>LESS WASTE. MORE CARE.</small>
          </span>
        </Link>
        <button
          className="icon-button mobile-close"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
        <div className="workspace-label">
          {role === "manager" ? "MESS WORKSPACE" : "STUDENT SPACE"}
        </div>
        <nav>
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              className={path === href ? "nav-link active" : "nav-link"}
              href={href}
              onClick={() => setOpen(false)}
            >
              <Icon size={19} />
              {label}
              {path === href && <ChevronRight size={15} />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" /> South Mess pilot
          <p>
            {mode === "demo"
              ? "A safe space to explore. All records are synthetic."
              : "Connected meal operations, one plate at a time."}
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className="user-row">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>
                {role === "manager" ? "Mess manager" : user.collegeId}
              </small>
            </span>
          </div>
          <button
            className="nav-link"
            onClick={() => {
              signOut().catch((e) => setError(e.message));
            }}
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span>Smart Mess</span>
            <ChevronRight size={14} />
            <strong>
              {links.find((l) => l.href === path)?.label ?? "Counter QR"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="environment-pill">
              <ShieldCheck size={14} />
              {mode === "demo" ? "Demo workspace" : "Live workspace"}
            </span>
            <span className="mini-avatar">{user.name[0]}</span>
          </div>
        </header>
        {mode === "demo" && (
          <div className="demo-banner">
            <span>
              <CircleHelp size={15} />
              <strong>Interactive demo</strong>
              <span className="demo-description">
                Synthetic data · saved in this browser · resets daily
              </span>
            </span>
            <button onClick={reset}>Reset demo</button>
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <main className="content">{children}</main>
        <footer className="footer">
          <span>
            <Sprout size={13} /> Thoughtful meals. Thoughtful management.
          </span>
          <span>Smart Mess · South Mess pilot</span>
        </footer>
      </div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-card">
      <div className="spinner" />
      <p>Loading your mess data…</p>
    </div>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="alert error" role="alert">
      <span>{message}</span>
      {retry && (
        <button className="button small secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <BookOpen size={24} />
      <p>{children}</p>
    </div>
  );
}
