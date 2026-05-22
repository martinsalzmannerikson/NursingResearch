import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { runLatestUpdate } from "./_shared/update.js";

export default async () => {
  const result = await runLatestUpdate();
  return jsonResponse(result, { status: result.ok ? 200 : 502 });
};

export const config: Config = {
  schedule: "0 5 * * *"
};
