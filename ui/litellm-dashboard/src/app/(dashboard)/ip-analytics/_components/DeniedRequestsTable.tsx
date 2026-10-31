import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableSortHeader } from "@/components/shared/DataTable";
import { DateCell } from "@/components/shared/table_cells";
import { Badge } from "@/components/ui/badge";
import type { DeniedRequestEntry } from "@/app/(dashboard)/hooks/ipAnalytics/useIpAnalytics";
import { DENIAL_REASON_LABELS, keyHashPreview } from "./ipAnalyticsLabels";

const deniedRowId = (row: DeniedRequestEntry): string =>
  [row.date, row.ip_address, row.route, row.status_code, row.reason, row.api_key].join("|");

const ipColumn = (onSelectIp: (ip: string) => void): ColumnDef<DeniedRequestEntry> => ({
  accessorKey: "ip_address",
  header: ({ column }) => <DataTableSortHeader column={column} title="IP Address" />,
  cell: ({ row }) => (
    <button
      type="button"
      className="font-mono text-xs text-info hover:underline"
      onClick={() => onSelectIp(row.original.ip_address)}
    >
      {row.original.ip_address}
    </button>
  ),
});

const sharedColumns: ColumnDef<DeniedRequestEntry>[] = [
  {
    accessorKey: "route",
    header: ({ column }) => <DataTableSortHeader column={column} title="Route" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.route}</span>,
  },
  {
    accessorKey: "status_code",
    header: ({ column }) => <DataTableSortHeader column={column} title="Status" />,
    meta: { numeric: true },
  },
  {
    accessorKey: "reason",
    header: ({ column }) => <DataTableSortHeader column={column} title="Reason" />,
    cell: ({ row }) => <Badge variant="secondary">{DENIAL_REASON_LABELS[row.original.reason]}</Badge>,
  },
  {
    accessorKey: "api_key",
    header: "Key",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.api_key ? (
        <span className="font-mono text-xs" title={row.original.api_key}>
          {keyHashPreview(row.original.api_key)}
        </span>
      ) : (
        <span className="text-muted-foreground">Unknown</span>
      ),
  },
  {
    accessorKey: "denied_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title="Denied" />,
    meta: { numeric: true },
    cell: ({ row }) => row.original.denied_requests.toLocaleString(),
  },
  {
    accessorKey: "date",
    header: ({ column }) => <DataTableSortHeader column={column} title="Day" />,
  },
  {
    accessorKey: "last_seen_at",
    header: ({ column }) => <DataTableSortHeader column={column} title="Last Seen" />,
    cell: ({ row }) => <DateCell value={row.original.last_seen_at} />,
  },
];

interface DeniedRequestsTableProps {
  readonly rows: readonly DeniedRequestEntry[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onSelectIp?: (ip: string) => void;
}

export function DeniedRequestsTable({ rows, isLoading, isError, onSelectIp }: DeniedRequestsTableProps) {
  const columns = onSelectIp ? [ipColumn(onSelectIp), ...sharedColumns] : sharedColumns;
  return (
    <DataTable
      data={[...rows]}
      columns={columns}
      getRowId={deniedRowId}
      sortingMode="client"
      defaultSorting={[{ id: "denied_requests", desc: true }]}
      paginationMode="client"
      isLoading={isLoading}
      isError={isError}
      errorMessage="Could not load denied requests"
      noDataMessage="No denied requests in this range"
      size="compact"
    />
  );
}
