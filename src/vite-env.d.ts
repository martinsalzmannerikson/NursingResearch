/// <reference types="vite/client" />

declare module "*.mjs" {
  const value: unknown;
  export default value;
  export const normalizeTitle: (value: string) => string;
  export const parseJournalCsv: (csvText: string) => unknown[];
  export const reconstructAbstract: (value: Record<string, number[]>) => string;
  export const dedupeWorks: <T>(items: T[]) => T[];
}
