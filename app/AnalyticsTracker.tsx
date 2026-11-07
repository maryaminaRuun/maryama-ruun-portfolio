"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

function sessionId() {
  try {
    let id = localStorage.getItem("mr-session");
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem("mr-session", id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export default function AnalyticsTracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || path.startsWith("/admin")) return;
    fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, session: sessionId(), referrer: document.referrer || null }),
      keepalive: true,
    }).catch(() => {});
  }, [path]);
  return null;
}
