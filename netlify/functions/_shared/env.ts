export function getEnv(name: string, fallback = "") {
  const globalWithNetlify = globalThis as typeof globalThis & {
    Netlify?: { env?: { get?: (key: string) => string | undefined } };
  };
  return globalWithNetlify.Netlify?.env?.get?.(name) ?? process.env[name] ?? fallback;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers
  });
}
