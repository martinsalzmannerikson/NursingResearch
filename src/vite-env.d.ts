/// <reference types="vite/client" />

declare module "*.mjs" {
  const value: unknown;
  export default value;
  export const normalizeTitle: (value: string) => string;
  export const parseJournalCsv: (csvText: string) => unknown[];
  export const reconstructAbstract: (value: Record<string, number[]>) => string;
  export const dedupeWorks: <T>(items: T[]) => T[];
  export const STORE_NAME: string;
  export const UPDATE_FREQUENCY: string;
  export const UPDATE_SCHEDULE: string;
  export const isOpenAlexStopErrorMessage: (value: string) => boolean;
  export const resolveJournalSource: (journal: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  export const sourceMapStats: (entries: unknown[]) => Record<string, number>;
  export const unresolvedRows: (entries: unknown[]) => Array<Record<string, unknown>>;
  export const fetchLatestWorks: (entries: unknown[], options?: Record<string, unknown>) => Promise<unknown>;
  export const latestFallback: (options?: Record<string, unknown>) => unknown;
}
