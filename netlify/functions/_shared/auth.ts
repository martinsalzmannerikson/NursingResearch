import { getEnv, jsonResponse } from "./env.js";

export function tokenFromRequest(request: Request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || url.searchParams.get("refresh_token");
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return queryToken || bearer || "";
}

export function requireRefreshToken(request: Request) {
  const expected = getEnv("REFRESH_TOKEN");
  if (!expected || expected === "change-me") {
    return jsonResponse({ error: "REFRESH_TOKEN is not configured." }, { status: 503 });
  }

  if (tokenFromRequest(request) !== expected) {
    return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
