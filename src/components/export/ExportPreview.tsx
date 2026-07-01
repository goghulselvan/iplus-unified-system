import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ExportPreviewProps {
  data: any[];
  columns: { key: string; label: string }[];
  isLoading: boolean;
  totalCount: number;
}

const ExportPreview = ({ data, columns, isLoading, totalCount }: ExportPreviewProps) => {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Please select at least one column to preview the data.
        </AlertDescription>
      </Alert>
    );
  }

  if (data.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No data found matching the selected filters. Try adjusting your filters.
        </AlertDescription>
      </Alert>
    );
  }

  const previewData = data.slice(0, 10);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Showing {previewData.length} of {totalCount} records</span>
        {totalCount > 10 && (
          <span className="text-xs">
            (Preview limited to first 10 rows)
          </span>
        )}
      </div>

      <ScrollArea className="h-[300px] border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(col => (
                <TableHead key={col.key} className="whitespace-nowrap">
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewData.map((row, idx) => (
              <TableRow key={idx}>
                {columns.map(col => (
                  <TableCell key={col.key} className="whitespace-nowrap">
                    {row[col.key] !== null && row[col.key] !== undefined 
                      ? String(row[col.key]) 
                      : '-'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      {totalCount > 1000 && (
        <Alert variant="destructive" className="bg-amber-50 border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Large dataset ({totalCount.toLocaleString()} records). Export may take a few moments.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default ExportPreview;
