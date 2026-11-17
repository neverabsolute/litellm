import type { ParseKeys } from "i18next";
import type { DenialReason } from "@/app/(dashboard)/hooks/ipAnalytics/useIpAnalytics";

export const DENIAL_REASON_LABELS: Readonly<Record<DenialReason, ParseKeys>> = {
  ip_not_allowed_global: "ipAnalytics.reasons.ipNotAllowedGlobal",
  ip_not_allowed_key: "ipAnalytics.reasons.ipNotAllowedKey",
  auth_error: "ipAnalytics.reasons.authError",
};

const KEY_HASH_PREVIEW_LENGTH = 12;

export const keyHashPreview = (apiKey: string): string =>
  apiKey.length > KEY_HASH_PREVIEW_LENGTH ? `${apiKey.slice(0, KEY_HASH_PREVIEW_LENGTH)}…` : apiKey;
