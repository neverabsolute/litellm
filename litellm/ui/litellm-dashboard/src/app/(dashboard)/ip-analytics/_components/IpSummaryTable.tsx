import type { ColumnDef } from "@tanstack/react-table";
import i18n from "@/i18n/i18n";
import { useTranslation } from "react-i18next";
import { DataTable, DataTableSortHeader } from "@/components/shared/DataTable";
import { DateCell, MoneyCell } from "@/components/shared/table_cells";
import type { IPSummaryEntry } from "@/app/(dashboard)/hooks/ipAnalytics/useIpAnalytics";

const count = (value: number) => value.toLocaleString();

const columns: ColumnDef<IPSummaryEntry>[] = [
  {
    accessorKey: "ip_address",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.ipAddress")} />,
    cell: ({ row }) => <span className="font-mono text-xs text-info">{row.original.ip_address}</span>,
  },
  {
    accessorKey: "successful_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.successful")} />,
    meta: { numeric: true, className: "text-success" },
    cell: ({ row }) => count(row.original.successful_requests),
  },
  {
    accessorKey: "failed_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.failed")} />,
    meta: { numeric: true, className: "text-destructive" },
    cell: ({ row }) => count(row.original.failed_requests),
  },
  {
    accessorKey: "denied_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.denied")} />,
    meta: { numeric: true, className: "text-warning" },
    cell: ({ row }) => count(row.original.denied_requests),
  },
  {
    accessorKey: "spend",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.spend")} />,
    meta: { numeric: true },
    cell: ({ row }) => <MoneyCell value={row.original.spend} decimals={2} />,
  },
  {
    accessorKey: "total_tokens",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.tokens")} />,
    meta: { numeric: true },
    cell: ({ row }) => count(row.original.total_tokens),
  },
  {
    accessorKey: "distinct_keys",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.keys")} />,
    meta: { numeric: true },
  },
  {
    accessorKey: "last_seen_at",
    header: ({ column }) => <DataTableSortHeader column={column} title={i18n.t("ipAnalytics.columns.lastSeen")} />,
    cell: ({ row }) => <DateCell value={row.original.last_seen_at} />,
  },
];

interface IpSummaryTableProps {
  readonly rows: readonly IPSummaryEntry[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onSelectIp: (ip: string) => void;
}

export function IpSummaryTable({ rows, isLoading, isError, onSelectIp }: IpSummaryTableProps) {
  const { t } = useTranslation();
  return (
    <DataTable
      data={[...rows]}
      columns={columns}
      getRowId={(row) => row.ip_address}
      sortingMode="client"
      defaultSorting={[{ id: "successful_requests", desc: true }]}
      paginationMode="client"
      onRowClick={(row) => onSelectIp(row.ip_address)}
      isLoading={isLoading}
      isError={isError}
      errorMessage={t("ipAnalytics.summary.error")}
      noDataMessage={t("ipAnalytics.summary.empty")}
      size="compact"
    />
  );
}
