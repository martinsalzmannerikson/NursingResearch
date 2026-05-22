import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { requireRefreshToken } from "./_shared/auth.js";
import { runLatestUpdate } from "./_shared/update.js";

export default async (request: Request) => {
  if (!["GET", "POST"].includes(request.method)) {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const authError = requireRefreshToken(request);
  if (authError) return authError;

  const result = await runLatestUpdate();
  return jsonResponse(result, { status: result.ok ? 200 : 502 });
};

export const config: Config = {};
