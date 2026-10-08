// Captures phone-sized screenshots of the live app with headless Chrome over CDP (no extra deps).
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "https://plain.lengway.me";
const OUT = process.argv[3] ?? "docs/screenshots";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGES = [
  ["landing", "/"],
  ["home", "/home"],
  ["earn", "/earn"],
  ["earn-usdy", "/earn/ondo-usdy"],
  ["assets", "/assets"],
  ["office", "/assets/demo-office"],
  ["portfolio", "/portfolio"],
  ["activity", "/activity"],
  ["demo-bank", "/demo-bank"],
];
const PORT = 9333;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), "rwa-shots-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

async function target() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not ready yet */ }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

try {
  const ws = new WebSocket(await target());
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    id += 1; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.THEME ?? "light" }] });

  for (const [name, route] of PAGES) {
    await send("Page.navigate", { url: `${BASE}${route}` });
    await sleep(6000);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.result.data, "base64"));
    console.log(`saved ${name}.png`);
  }
  ws.close();
} finally {
  chrome.kill();
}
