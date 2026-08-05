import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ProductFilters = {
  search: string;
  categoryId: string;      // 'all' or a category id
  itemType: string;        // 'all' | 'consumable' | 'saleable'
  series: string;          // 'all' or a series value
  subject: string;         // 'all' or a subject value
  classNumber: string;     // 'all' or a class number as string
  stockStatus: string;     // 'all' | 'low' | 'out'
  activeStatus: string;    // 'all' | 'active' | 'inactive'
};

export const DEFAULT_FILTERS: ProductFilters = {
  search: '', categoryId: 'all', itemType: 'all', series: 'all',
  subject: 'all', classNumber: 'all', stockStatus: 'all', activeStatus: 'all',
};

export default function ProductsFilterBar({
  filters, onChange, categories, seriesOptions, subjectOptions, classOptions, hideActiveStatus,
}: {
  filters: ProductFilters;
  onChange: (f: ProductFilters) => void;
  categories: { id: string; name: string }[];
  seriesOptions: string[];
  subjectOptions: string[];
  classOptions: string[];
  hideActiveStatus?: boolean;
}) {
  const set = (patch: Partial<ProductFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <Input
        placeholder="Search by name or SKU…"
        value={filters.search}
        onChange={e => set({ search: e.target.value })}
        className="max-w-xs"
      />
      <Select value={filters.categoryId} onValueChange={v => set({ categoryId: v })}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.itemType} onValueChange={v => set({ itemType: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Item Type" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="saleable">Saleable</SelectItem>
          <SelectItem value="consumable">Consumable</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.series} onValueChange={v => set({ series: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Series" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Series</SelectItem>
          {seriesOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.subject} onValueChange={v => set({ subject: v })}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Subject" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Subjects</SelectItem>
          {subjectOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.classNumber} onValueChange={v => set({ classNumber: v })}>
        <SelectTrigger className="w-[120px]"><SelectValue placeholder="Class" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Classes</SelectItem>
          {classOptions.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.stockStatus} onValueChange={v => set({ stockStatus: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Stock" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Stock</SelectItem>
          <SelectItem value="low">Low Stock</SelectItem>
          <SelectItem value="out">Out of Stock</SelectItem>
        </SelectContent>
      </Select>
      {!hideActiveStatus && (
        <Select value={filters.activeStatus} onValueChange={v => set({ activeStatus: v })}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
