"use client";

import { Globe, Info } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import {
  type IpAnalyticsRange,
  useDeniedRequests,
  useIpSummary,
} from "@/app/(dashboard)/hooks/ipAnalytics/useIpAnalytics";
import { formatDate } from "@/components/networking";
import { Alert, AlertDescription } from "@/components/shared/Alert";
import AdvancedDatePicker from "@/components/shared/advanced_date_picker";
import type { DateRangePickerValue } from "@/components/shared/date_picker_types";
import { Page, PageTabs, PageTabsList, PageTabsTrigger } from "@/components/shared/Page";
import { PageHeader, PageHeaderControls, PageHeaderDescription, PageHeaderTitle } from "@/components/shared/PageHeader";
import { TabsContent } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/useUrlTab";
import { proxyAdminTierRoles } from "@/utils/roles";
import { DeniedRequestsTable } from "./DeniedRequestsTable";
import { IpDetailSheet } from "./IpDetailSheet";
import { IpSummaryTable } from "./IpSummaryTable";

const TABS = ["ips", "denied"] as const;
const DEFAULT_LOOKBACK_DAYS = 7;

const lastWeek = (): DateRangePickerValue => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - DEFAULT_LOOKBACK_DAYS);
  return { from, to };
};

const toRange = ({ from, to }: DateRangePickerValue): IpAnalyticsRange => {
  const end = to ?? new Date();
  return { start_date: formatDate(from ?? end), end_date: formatDate(end) };
};

function IpAnalyticsContent() {
  const [dateValue, setDateValue] = useState<DateRangePickerValue>(lastWeek);
  const [tab, setTab] = useUrlTab(TABS, "ips");
  const [selectedIp, setSelectedIp] = useQueryState("ip", parseAsString.withOptions({ history: "push" }));
  const range = toRange(dateValue);
  const summary = useIpSummary(range);
  const denied = useDeniedRequests(range);
  const selectIp = (ip: string) => void setSelectedIp(ip);

  return (
    <PageTabs value={tab} onValueChange={(value) => setTab(value as (typeof TABS)[number])}>
      <PageHeader>
        <PageHeaderTitle>
          <Globe />
          IP Analytics
        </PageHeaderTitle>
        <PageHeaderDescription>Which addresses call your gateway, and which ones it turns away</PageHeaderDescription>
        <PageHeaderControls>
          <PageTabsList>
            <PageTabsTrigger value="ips">By IP Address</PageTabsTrigger>
            <PageTabsTrigger value="denied">Denied Requests</PageTabsTrigger>
          </PageTabsList>
          <AdvancedDatePicker value={dateValue} onValueChange={setDateValue} label="" showTimeRange={false} />
        </PageHeaderControls>
      </PageHeader>

      <Alert variant="info">
        <Info />
        <AlertDescription>
          Successful and failed counts come from logged LLM requests. Denied counts every request rejected at
          authentication on any route, including management and UI routes, unauthenticated calls and IP allow-list
          blocks, so a denied LLM call shows up as both failed and denied. Counts are rolled up per day and written
          every few seconds to minutes, so the latest requests can take a moment to appear
        </AlertDescription>
      </Alert>

      <TabsContent value="ips">
        <IpSummaryTable
          rows={summary.data?.ips ?? []}
          isLoading={summary.isLoading}
          isError={summary.isError}
          onSelectIp={selectIp}
        />
      </TabsContent>
      <TabsContent value="denied">
        <DeniedRequestsTable
          rows={denied.data?.denied ?? []}
          isLoading={denied.isLoading}
          isError={denied.isError}
          onSelectIp={selectIp}
        />
      </TabsContent>

      <IpDetailSheet ipAddress={selectedIp} range={range} onClose={() => void setSelectedIp(null)} />
    </PageTabs>
  );
}

export default function IpAnalyticsView() {
  const { userRole } = useAuthorized();
  return (
    <Page>
      {proxyAdminTierRoles.includes(userRole || "") ? (
        <IpAnalyticsContent />
      ) : (
        <Alert variant="info">
          <AlertDescription>IP Analytics is only available to proxy admins.</AlertDescription>
        </Alert>
      )}
    </Page>
  );
}
