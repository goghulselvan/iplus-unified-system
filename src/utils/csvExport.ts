/**
 * Escape a single CSV cell value properly
 * - Wraps value in double quotes
 * - Escapes internal double quotes by doubling them (per CSV spec)
 */
export const escapeCSVCell = (value: any): string => {
  const str = String(value ?? '');
  // Escape double quotes by doubling them, then wrap in quotes
  return `"${str.replace(/"/g, '""')}"`;
};

/**
 * Convert a 2D array to a properly formatted CSV string
 * All cells are properly escaped to handle commas, quotes, and newlines
 */
export const toCSV = (data: (string | number | null | undefined)[][]): string => {
  return data.map(row => row.map(escapeCSVCell).join(',')).join('\n');
};

/**
 * Download a CSV file with proper formatting
 */
export const downloadCSV = (data: (string | number | null | undefined)[][], filename: string): void => {
  const csvContent = toCSV(data);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
