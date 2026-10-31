/**
 * Utility functions for LogDetailsDrawer component.
 * These functions handle data formatting and validation.
 */

export type SessionLogSortMode = "duration" | "start_time";

type SortableSessionLog = { startTime: string; endTime: string; request_duration_ms?: number };

const durationMs = (row: SortableSessionLog): number =>
  row.request_duration_ms ?? Date.parse(row.endTime) - Date.parse(row.startTime);

export function sortSessionLogs<T extends SortableSessionLog>(rows: T[], mode: SessionLogSortMode): T[] {
  if (mode === "start_time") {
    return [...rows].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }
  return [...rows].sort((a, b) => durationMs(b) - durationMs(a));
}

/**
 * Formats data for display. If input is a string, attempts to parse as JSON.
 * @param input - Data to format (string or object)
 * @returns Parsed JSON object or original input
 */
export function formatData(input: any) {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  return input;
}

/**
 * Checks if messages array/object contains data.
 * @param messages - Messages to check
 * @returns True if messages exist and have content
 */
export function checkHasMessages(messages: any): boolean {
  if (!messages) return false;
  if (Array.isArray(messages)) return messages.length > 0;
  if (typeof messages === "object") return Object.keys(messages).length > 0;
  return false;
}

/**
 * Checks if response object contains data.
 * @param response - Response to check
 * @returns True if response exists and has content
 */
export function checkHasResponse(response: any): boolean {
  if (!response) return false;
  return Object.keys(formatData(response)).length > 0;
}
