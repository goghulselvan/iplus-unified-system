import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, ArrowLeft, ChevronDown, LayoutDashboard, Package, FileText, Truck, ClipboardList, PackageMinus, ArrowUpDown, BarChart3, FileBarChart, PackageSearch, TrendingUp, RotateCcw, Wallet } from 'lucide-react';

const standaloneNav = [
  { label: 'Dashboard', href: '/sales/dashboard', icon: LayoutDashboard },
  { label: 'Order Requests', href: '/sales/order-requests', icon: PackageSearch },
  { label: 'Invoices', href: '/sales/invoices', icon: FileText },
  { label: 'Products', href: '/sales/products', icon: Package },
];

function NavBadge({ count }: { count: number }) {
  if (count === 0) return null;
  // Blue, not red — red barely contrasts against this nav's orange background.
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

// Orders needing staff action right now: payment not yet reviewed, or payment
// confirmed but at least one line item still awaiting a stock decision.
function useOrderRequestsBadge() {
  return useQuery({
    queryKey: ['sales-order-requests-badge'],
    queryFn: async () => {
      const [{ count: paymentPending }, { data: confirmedOrders }, { data: pendingItems }] = await Promise.all([
        supabase.from('product_orders').select('*', { count: 'exact', head: true }).eq('payment_status', 'pending'),
        supabase.from('product_orders').select('id').eq('payment_status', 'confirmed'),
        supabase.from('product_order_items').select('order_id').eq('line_status', 'pending'),
      ]);
      const confirmedIds = new Set((confirmedOrders ?? []).map((o) => o.id));
      const stockPendingOrderIds = new Set(
        (pendingItems ?? []).filter((i) => confirmedIds.has(i.order_id)).map((i) => i.order_id)
      );
      return (paymentPending ?? 0) + stockPendingOrderIds.size;
    },
    refetchInterval: 30_000,
    staleTime: 0,
  });
}

function useReturnsBadge() {
  return useQuery({
    queryKey: ['sales-returns-badge'],
    queryFn: async () => {
      const { count } = await supabase.from('product_returns' as any).select('*', { count: 'exact', head: true }).in('status', ['requested', 'credit_issued']);
      return count ?? 0;
    },
    refetchInterval: 30_000,
    staleTime: 0,
  });
}

const navGroups = [
  {
    label: 'Procurement',
    items: [
      { label: 'Suppliers', href: '/sales/suppliers', icon: Truck },
      { label: 'Purchase Orders', href: '/sales/purchase-orders', icon: ClipboardList },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Stock Movements', href: '/sales/stock-movements', icon: ArrowUpDown },
      { label: 'Item Issue', href: '/sales/item-issue', icon: PackageMinus },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Stock Report', href: '/sales/stock-report', icon: BarChart3 },
      { label: 'Purchase Report', href: '/sales/purchase-report', icon: FileBarChart },
      { label: 'Sales Analytics', href: '/sales/analytics', icon: TrendingUp },
    ],
  },
  {
    label: 'Returns',
    items: [
      { label: 'Returns', href: '/sales/returns', icon: RotateCcw },
      { label: 'Credit Notes', href: '/sales/credit-notes', icon: Wallet },
    ],
  },
];

const SalesLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: orderRequestsBadge = 0 } = useOrderRequestsBadge();
  const { data: returnsBadge = 0 } = useReturnsBadge();

  const linkClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-white text-orange-700'
        : 'text-orange-100 hover:bg-orange-700 hover:text-white'
    }`;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <nav className="bg-orange-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-orange-100 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="h-5 w-px bg-orange-400" />
              <span className="font-semibold text-sm tracking-wide text-white">Sales</span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {standaloneNav.map(({ label, href, icon: Icon }) => (
                  <Link key={href} to={href} className={linkClass(location.pathname === href)}>
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    {href === '/sales/order-requests' && <NavBadge count={orderRequestsBadge} />}
                  </Link>
                ))}
                {navGroups.map((group) => {
                  const isActive = group.items.some((item) => location.pathname === item.href);
                  return (
                    <DropdownMenu key={group.label}>
                      <DropdownMenuTrigger asChild>
                        <button className={linkClass(isActive)}>
                          {group.label}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        {group.items.map(({ label, href, icon: Icon }) => (
                          <DropdownMenuItem key={href} asChild>
                            <Link
                              to={href}
                              className={`flex items-center gap-2 w-full ${
                                location.pathname === href ? 'bg-accent text-accent-foreground' : ''
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                              {href === '/sales/returns' && returnsBadge > 0 && (
                                <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none">
                                  {returnsBadge > 99 ? '99+' : returnsBadge}
                                </span>
                              )}
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-orange-100 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-orange-100 hover:text-white hover:bg-orange-700 h-8 w-8 p-0"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  );
};

export default SalesLayout;
