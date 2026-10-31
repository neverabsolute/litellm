import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { $api } from "@/lib/http/api";
import type { components } from "@/lib/http/schema";
import { proxyAdminTierRoles } from "@/utils/roles";

export type IPSummaryEntry = components["schemas"]["IPSummaryEntry"];
export type IPKeyActivityEntry = components["schemas"]["IPKeyActivityEntry"];
export type DeniedRequestEntry = components["schemas"]["DeniedRequestEntry"];
export type DenialReason = DeniedRequestEntry["reason"];

export interface IpAnalyticsRange {
  readonly start_date: string;
  readonly end_date: string;
}

const SUMMARY_LIMIT = 100;
const DENIED_LIMIT = 200;

const useCanViewIpAnalytics = (): boolean => {
  const { accessToken, userRole } = useAuthorized();
  return Boolean(accessToken) && proxyAdminTierRoles.includes(userRole || "");
};

export const useIpSummary = (range: IpAnalyticsRange) => {
  const enabled = useCanViewIpAnalytics();
  return $api.useQuery(
    "get",
    "/ip_analytics/summary",
    { params: { query: { ...range, limit: SUMMARY_LIMIT } } },
    { enabled },
  );
};

export const useDeniedRequests = (range: IpAnalyticsRange) => {
  const enabled = useCanViewIpAnalytics();
  return $api.useQuery(
    "get",
    "/ip_analytics/denied",
    { params: { query: { ...range, limit: DENIED_LIMIT } } },
    { enabled },
  );
};

export const useIpDetail = (ipAddress: string | null, range: IpAnalyticsRange) => {
  const enabled = useCanViewIpAnalytics() && ipAddress !== null;
  return $api.useQuery(
    "get",
    "/ip_analytics/ip",
    { params: { query: { ...range, ip_address: ipAddress ?? "" } } },
    { enabled },
  );
};
