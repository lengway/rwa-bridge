"use client";

import { useEffect, useState } from "react";

export function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);
  return now;
}
