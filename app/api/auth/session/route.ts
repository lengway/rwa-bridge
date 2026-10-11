import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, createAuthJwt, verifySessionCookie } from "@/lib/auth-server";

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_SESSION_COOKIE}=`))
    ?.slice(AUTH_SESSION_COOKIE.length + 1);
  let email: string | null = null;
  try {
    email = verifySessionCookie(cookie ? decodeURIComponent(cookie) : null);
  } catch {
    email = null;
  }
  if (!email) {
    return NextResponse.json({ error: "Session is inactive." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ email, jwt: createAuthJwt(email) }, { headers: { "Cache-Control": "no-store" } });
}
