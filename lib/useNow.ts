"use client";

import { useEffect, useState } from "react";
import { ACCELERATED_DAY_MS } from "@/lib/yields";
import { useAppStore } from "@/lib/store";

export function useNow() {
  const { acceleratedAccrual } = useAppStore();
  const intervalMs = acceleratedAccrual ? ACCELERATED_DAY_MS / 4 : 1_000;
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
