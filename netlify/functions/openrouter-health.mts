import type { Config } from "@netlify/functions";
import { getEnv, jsonResponse } from "./_shared/env.js";
import { cleanBriefText } from "./_shared/brief-utils.js";
import { configuredOpenRouterModels, extractOpenRouterContent } from "./_shared/brief-openrouter.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export default async (request: Request) => {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, { status: 405 });

  const apiKey = getEnv("OPENROUTER_API_KEY");
  const { model } = configuredOpenRouterModels();
  if (!apiKey || !model) {
    return jsonResponse({
      success: false,
      modelUsed: model || null,
      statusCode: null,
      responseContentLength: 0,
      responseTextPreview: !apiKey ? "OPENROUTER_API_KEY is not set." : "OPENROUTER_MODEL is not set."
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": getEnv("OPENROUTER_APP_TITLE", "Nursing Research Monitor")
  };
  const siteUrl = getEnv("OPENROUTER_SITE_URL");
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;

  const body = {
    model,
    messages: [
      { role: "system", content: "Return exactly OK." },
      { role: "user", content: "Return exactly OK." }
    ],
    temperature: 0,
    max_completion_tokens: 128,
    reasoning: { effort: "minimal", exclude: true }
  };

  let statusCode: number | null = null;
  let responseText = "";
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    statusCode = response.status;
    const raw = await response.text();
    if (response.ok) {
      const parsed = JSON.parse(raw) as { choices?: Array<{ message?: unknown; finish_reason?: string }>; model?: string };
      responseText = extractOpenRouterContent(parsed.choices?.[0]?.message);
      return jsonResponse({
        success: /^OK\.?$/i.test(responseText.trim()),
        modelUsed: parsed.model || model,
        statusCode,
        finishReason: parsed.choices?.[0]?.finish_reason || null,
        responseContentLength: responseText.length,
        responseTextPreview: cleanBriefText(responseText, 120)
      });
    }
    responseText = raw;
  } catch (error) {
    responseText = (error as Error).message;
  }

  return jsonResponse({
    success: false,
    modelUsed: model,
    statusCode,
    responseContentLength: responseText.length,
    responseTextPreview: cleanBriefText(responseText, 300)
  });
};

export const config: Config = {};
