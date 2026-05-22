import type { Config } from "@netlify/functions";
import { getEnv, jsonResponse } from "./_shared/env.js";
import { runLatestUpdate } from "./_shared/update.js";

function tokenFromRequest(request: Request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || url.searchParams.get("refresh_token");
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return queryToken || bearer || "";
}

export default async (request: Request) => {
  if (!["GET", "POST"].includes(request.method)) {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const expected = getEnv("REFRESH_TOKEN");
  if (!expected || expected === "change-me") {
    return jsonResponse({ error: "REFRESH_TOKEN is not configured." }, { status: 503 });
  }

  if (tokenFromRequest(request) !== expected) {
    return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await runLatestUpdate();
  return jsonResponse(result, { status: result.ok ? 200 : 502 });
};

export const config: Config = {};
