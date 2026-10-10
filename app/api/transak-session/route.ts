import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";
import { TRANSAK_MIN_USD } from "@/lib/onramps";
import { createWidgetUrl, transakConfig } from "@/lib/transak";

const MISSING_SECRET_MESSAGE = "Добавьте TRANSAK_API_SECRET в .env.local, чтобы включить Transak в тестовом режиме.";
const MISSING_API_KEY_MESSAGE = "Добавьте NEXT_PUBLIC_TRANSAK_API_KEY в .env.local, чтобы включить Transak в тестовом режиме.";
const IP_LOOKUP_CACHE_TTL = 10 * 60 * 1000;

let cachedPublicEgressIp: { address: string; expiresAt: number } | null = null;
let publicEgressIpLookup: Promise<string | null> | null = null;

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

function isIpv4InRange(address: string, network: string, prefixLength: number): boolean {
  const blockSize = 2 ** (32 - prefixLength);
  return Math.floor(ipv4ToNumber(address) / blockSize)
    === Math.floor(ipv4ToNumber(network) / blockSize);
}

function isPublicIpv4(address: string): boolean {
  const nonPublicRanges: [string, number][] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return !nonPublicRanges.some(([network, prefixLength]) => (
    isIpv4InRange(address, network, prefixLength)
  ));
}

function parseIpv6Bytes(address: string): number[] | null {
  let normalizedAddress = address;
  if (normalizedAddress.includes(".")) {
    const lastColon = normalizedAddress.lastIndexOf(":");
    const ipv4Address = normalizedAddress.slice(lastColon + 1);
    const octets = ipv4Address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    const highWord = ((octets[0] << 8) | octets[1]).toString(16);
    const lowWord = ((octets[2] << 8) | octets[3]).toString(16);
    normalizedAddress = `${normalizedAddress.slice(0, lastColon + 1)}${highWord}:${lowWord}`;
  }

  const separatorIndex = normalizedAddress.indexOf("::");
  const hasCompression = separatorIndex !== -1;
  const leftPart = hasCompression ? normalizedAddress.slice(0, separatorIndex) : normalizedAddress;
  const rightPart = hasCompression ? normalizedAddress.slice(separatorIndex + 2) : "";
  const leftWords = leftPart ? leftPart.split(":") : [];
  const rightWords = rightPart ? rightPart.split(":") : [];
  const missingWords = 8 - leftWords.length - rightWords.length;
  if ((!hasCompression && missingWords !== 0) || (hasCompression && missingWords < 1)) return null;

  const words = [
    ...leftWords,
    ...Array(hasCompression ? missingWords : 0).fill("0"),
    ...rightWords,
  ];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;

  return words.flatMap((word) => {
    const value = Number.parseInt(word, 16);
    return [value >> 8, value & 0xff];
  });
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return false;

  const isIpv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff
    && bytes[11] === 0xff;
  if (isIpv4Mapped) {
    const mappedIpv4 = bytes.slice(12).join(".");
    return isPublicIpv4(mappedIpv4);
  }

  const isGlobalUnicast = (bytes[0] & 0xe0) === 0x20;
  const isDocumentationRange = bytes[0] === 0x20 && bytes[1] === 0x01
    && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const isReserved2001Range = bytes[0] === 0x20 && bytes[1] === 0x01
    && bytes[2] === 0 && (bytes[3] & 0xfe) === 0;

  return isGlobalUnicast && !isDocumentationRange && !isReserved2001Range;
}

function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

async function getMachinePublicEgressIp(): Promise<string | null> {
  if (cachedPublicEgressIp && cachedPublicEgressIp.expiresAt > Date.now()) {
    return cachedPublicEgressIp.address;
  }
  if (publicEgressIpLookup) return publicEgressIpLookup;

  publicEgressIpLookup = (async () => {
    try {
      const response = await fetch("https://api.ipify.org", {
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      if (!response.ok) return null;

      const address = (await response.text()).trim();
      if (!isPublicIp(address)) return null;

      cachedPublicEgressIp = { address, expiresAt: Date.now() + IP_LOOKUP_CACHE_TTL };
      return address;
    } catch {
      return null;
    } finally {
      publicEgressIpLookup = null;
    }
  })();

  return publicEgressIpLookup;
}

export async function GET() {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("transak");

  if (!transakConfig.apiKeyConfigured) {
    return NextResponse.json({ configured: false, message: MISSING_API_KEY_MESSAGE });
  }
  if (!transakConfig.secretConfigured) {
    return NextResponse.json({ configured: false, message: MISSING_SECRET_MESSAGE });
  }
  return NextResponse.json({ configured: true });
}

export async function POST(request: Request) {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("transak");

  if (!transakConfig.secretConfigured) {
    return NextResponse.json({ error: MISSING_SECRET_MESSAGE }, { status: 501 });
  }
  if (!transakConfig.apiKeyConfigured) {
    return NextResponse.json({ error: MISSING_API_KEY_MESSAGE }, { status: 501 });
  }

  const body = await request.json().catch(() => null);
  const walletAddress = body?.walletAddress;
  const emailCandidate = body?.email;
  const email = typeof emailCandidate === "string"
    && emailCandidate.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCandidate)
    ? emailCandidate
    : undefined;
  const amountUsd = Number(body?.amountUsd);
  if (
    typeof walletAddress !== "string"
    || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)
    || !Number.isFinite(amountUsd)
    || amountUsd > 1000
  ) {
    return NextResponse.json(
      { error: "Укажите адрес Solana и сумму от $1 до $1 000." },
      { status: 400 },
    );
  }
  if (amountUsd < TRANSAK_MIN_USD) {
    return NextResponse.json(
      { error: "Минимальная сумма для Transak — $30." },
      { status: 400 },
    );
  }

  let referrerDomain: string;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const parsedHost = new URL(`http://${host}`);
    if (parsedHost.username || parsedHost.password || parsedHost.pathname !== "/") {
      throw new Error("invalid host");
    }
    referrerDomain = parsedHost.hostname;
  } catch {
    return NextResponse.json({ error: "Не удалось определить домен приложения." }, { status: 400 });
  }

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  let userIp = [forwardedIp, realIp].find((value) => Boolean(value && isPublicIp(value)));
  const normalizedHost = referrerDomain.replace(/^\[|\]$/g, "");
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(normalizedHost);

  if (!userIp && isLocalHost) {
    // Local development needs the public egress IP because Transak binds each session to the supplied user IP.
    userIp = await getMachinePublicEgressIp() ?? undefined;
  }
  if (!userIp) {
    return NextResponse.json(
      { error: "Не удалось определить IP для тестовой сессии Transak." },
      { status: 502 },
    );
  }

  try {
    const widgetUrl = await createWidgetUrl({
      walletAddress,
      fiatAmount: amountUsd,
      fiatCurrency: "USD",
      userIp,
      referrerDomain,
      email,
    });
    return NextResponse.json({ widgetUrl });
  } catch {
    return NextResponse.json(
      { error: "Transak не смог создать тестовую сессию. Попробуйте ещё раз." },
      { status: 502 },
    );
  }
}
