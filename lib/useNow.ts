"use client";

import { useEffect, useState } from "react";
import { DEMO_DAY_MS } from "@/lib/yields";

export function useNow(intervalMs = DEMO_DAY_MS / 4) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
