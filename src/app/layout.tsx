import type { Metadata, Viewport } from "next";
import { Provider } from "@/components/provider";
import { appMode } from "@/lib/auth";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Smart Mess — Thoughtful meals, made simple",
    template: "%s · Smart Mess",
  },
  description:
    "Student meal verification, mess operations, accountable balances and aggregate demand planning.",
  applicationName: "Smart Mess",
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#121215",
};
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Provider mode={appMode()}>{children}</Provider>
      </body>
    </html>
  );
}
