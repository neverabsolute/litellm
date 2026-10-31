import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableSortHeader } from "@/components/shared/DataTable";
import { MoneyCell } from "@/components/shared/table_cells";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  type IpAnalyticsRange,
  type IPKeyActivityEntry,
  useIpDetail,
} from "@/app/(dashboard)/hooks/ipAnalytics/useIpAnalytics";
import { DeniedRequestsTable } from "./DeniedRequestsTable";
import { keyHashPreview } from "./ipAnalyticsLabels";

const keyColumns: ColumnDef<IPKeyActivityEntry>[] = [
  {
    accessorKey: "key_alias",
    header: "Key",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.key_alias || "Unnamed key"}</span>
        <span className="font-mono text-xs text-muted-foreground" title={row.original.api_key}>
          {keyHashPreview(row.original.api_key)}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "successful_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title="Successful" />,
    meta: { numeric: true, className: "text-success" },
    cell: ({ row }) => row.original.successful_requests.toLocaleString(),
  },
  {
    accessorKey: "failed_requests",
    header: ({ column }) => <DataTableSortHeader column={column} title="Failed" />,
    meta: { numeric: true, className: "text-destructive" },
    cell: ({ row }) => row.original.failed_requests.toLocaleString(),
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
    cell: ({ row }) => row.original.total_tokens.toLocaleString(),
  },
];

interface IpDetailSheetProps {
  readonly ipAddress: string | null;
  readonly range: IpAnalyticsRange;
  readonly onClose: () => void;
}

export function IpDetailSheet({ ipAddress, range, onClose }: IpDetailSheetProps) {
  const detail = useIpDetail(ipAddress, range);
  return (
    <Sheet open={ipAddress !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:max-w-full data-[side=right]:sm:w-[880px] data-[side=right]:sm:max-w-full">
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono">{ipAddress}</SheetTitle>
          <SheetDescription>
            Activity from {range.start_date} through {range.end_date}
          </SheetDescription>
        </SheetHeader>
        <section className="flex flex-col gap-2 px-4">
          <h3 className="text-sm font-semibold">Keys used from this address</h3>
          <DataTable
            data={[...(detail.data?.by_key ?? [])]}
            columns={keyColumns}
            getRowId={(row) => row.api_key}
            sortingMode="client"
            defaultSorting={[{ id: "successful_requests", desc: true }]}
            isLoading={detail.isLoading}
            isError={detail.isError}
            errorMessage="Could not load activity for this address"
            noDataMessage="No logged LLM requests from this address"
            size="compact"
          />
        </section>
        <section className="flex flex-col gap-2 px-4 pb-4">
          <h3 className="text-sm font-semibold">Denied requests</h3>
          <DeniedRequestsTable rows={detail.data?.denied ?? []} isLoading={detail.isLoading} isError={detail.isError} />
        </section>
      </SheetContent>
    </Sheet>
  );
}
