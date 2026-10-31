import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableSortHeader } from "@/components/shared/DataTable";
import { DateCell, MoneyCell } from "@/components/shared/table_cells";
import type { IPSummaryEntry } from "@/app/(dashboard)/hooks/ipAnalytics/useIpAnalytics";

const count = (value: number) => value.toLocaleString();

const columns: ColumnDef<IPSummaryEntry>[] = [
  {
    accessorKey: "ip_address",
    header: ({ column }) => <DataTableSortHeader column={column} title="IP Address" />,
    cell: ({ row }) => <span className="font-mono text-xs text-info">{row.original.ip_address}</span>,
  },
  {
    accessorKey: "successful_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title="Successful" />,
    meta: { numeric: true, className: "text-success" },
    cell: ({ row }) => count(row.original.successful_requests),
  },
  {
    accessorKey: "failed_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title="Failed" />,
    meta: { numeric: true, className: "text-destructive" },
    cell: ({ row }) => count(row.original.failed_requests),
  },
  {
    accessorKey: "denied_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title="Denied" />,
    meta: { numeric: true, className: "text-warning" },
    cell: ({ row }) => count(row.original.denied_requests),
  },
  {
    accessorKey: "spend",
    header: ({ column }) => <DataTableSortHeader column={column} title="Spend" />,
    meta: { numeric: true },
    cell: ({ row }) => <MoneyCell value={row.original.spend} decimals={2} />,
  },
  {
    accessorKey: "total_tokens",
    header: ({ column }) => <DataTableSortHeader column={column} title="Tokens" />,
    meta: { numeric: true },
    cell: ({ row }) => count(row.original.total_tokens),
  },
  {
    accessorKey: "distinct_keys",
    header: ({ column }) => <DataTableSortHeader column={column} title="Keys" />,
    meta: { numeric: true },
  },
  {
    accessorKey: "last_seen_at",
    header: ({ column }) => <DataTableSortHeader column={column} title="Last Seen" />,
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
      errorMessage="Could not load IP activity"
      noDataMessage="No requests recorded in this range"
      size="compact"
    />
  );
}
