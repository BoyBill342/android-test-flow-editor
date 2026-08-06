type LogLevel = "INFO" | "WARN" | "ERROR";

interface AppLogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  details: string;
}

const STORAGE_KEY = "adb-editor-debug-logs";
const MAX_ENTRIES = 500;
const MAX_DETAILS_CHARS = 1200;

function stringifyDetails(details: unknown): string {
  if (details === undefined) {
    return "";
  }

  if (typeof details === "string") {
    return details.slice(0, MAX_DETAILS_CHARS);
  }

  try {
    return JSON.stringify(details).slice(0, MAX_DETAILS_CHARS);
  } catch {
    return String(details).slice(0, MAX_DETAILS_CHARS);
  }
}

function loadEntries(): AppLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as AppLogEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function saveEntries(entries: AppLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage quota and unavailable storage errors
  }
}

function appendLog(level: LogLevel, event: string, details?: unknown): void {
  const entry: AppLogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    details: stringifyDetails(details),
  };

  const entries = loadEntries();
  entries.push(entry);

  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }

  saveEntries(entries);

  if (level === "ERROR") {
    console.error(`[app] ${event}`, details);
    return;
  }
  if (level === "WARN") {
    console.warn(`[app] ${event}`, details);
    return;
  }
  console.info(`[app] ${event}`, details);
}

export const appLogger = {
  info: (event: string, details?: unknown) => appendLog("INFO", event, details),
  warn: (event: string, details?: unknown) => appendLog("WARN", event, details),
  error: (event: string, details?: unknown) => appendLog("ERROR", event, details),
  exportAsText: (): string => {
    const entries = loadEntries();
    if (entries.length === 0) {
      return "(no client debug logs)";
    }

    return entries
      .map((item) => `${item.ts} [${item.level}] ${item.event}${item.details ? ` | ${item.details}` : ""}`)
      .join("\n");
  },
  clear: (): void => {
    saveEntries([]);
  },
};
