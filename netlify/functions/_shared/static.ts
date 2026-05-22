import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readStaticJson<T>(relativePath: string): Promise<T | null> {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(process.cwd(), "dist", relativePath.replace(/^public[\\/]/, "")),
    path.join(process.cwd(), relativePath.replace(/^public[\\/]/, ""))
  ];

  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, "utf8");
      return JSON.parse(text) as T;
    } catch {
      // Try the next deployment/runtime path.
    }
  }
  return null;
}
