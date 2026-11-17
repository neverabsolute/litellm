const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export const storedAllowedIps = (metadata: unknown): string[] => {
  const raw = asRecord(metadata)?.allowed_ips;
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
};

export const withoutAllowedIps = (
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  if (metadata == null) return metadata;
  const { allowed_ips: _omitted, ...rest } = metadata;
  return rest;
};

export const withStoredAllowedIps = (
  metadata: Record<string, unknown>,
  stored: readonly string[],
): Record<string, unknown> => {
  const { allowed_ips: _omitted, ...rest } = metadata;
  return stored.length > 0 ? { ...rest, allowed_ips: [...stored] } : rest;
};

export const allowedIpsChange = (
  submitted: readonly string[] | undefined,
  stored: readonly string[],
): string[] | undefined => {
  if (submitted === undefined) return undefined;
  const unchanged = submitted.length === stored.length && submitted.every((entry) => stored.includes(entry));
  return unchanged ? undefined : [...submitted];
};
