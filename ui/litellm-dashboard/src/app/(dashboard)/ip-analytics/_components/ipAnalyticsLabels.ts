import type { DenialReason } from "@/app/(dashboard)/hooks/ipAnalytics/useIpAnalytics";

export const DENIAL_REASON_LABELS: Readonly<Record<DenialReason, string>> = {
  ip_not_allowed_global: "IP not in global allow-list",
  ip_not_allowed_key: "IP not allowed for this key",
  auth_error: "Authentication failed",
};

const KEY_HASH_PREVIEW_LENGTH = 12;

export const keyHashPreview = (apiKey: string): string =>
  apiKey.length > KEY_HASH_PREVIEW_LENGTH ? `${apiKey.slice(0, KEY_HASH_PREVIEW_LENGTH)}…` : apiKey;
