import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, ArrowLeft, ChevronDown, LayoutDashboard, Package, FileText, Truck, ClipboardList, PackageMinus, ArrowUpDown, BarChart3, FileBarChart, PackageSearch } from 'lucide-react';

const standaloneNav = [
  { label: 'Dashboard', href: '/sales/dashboard', icon: LayoutDashboard },
  { label: 'Order Requests', href: '/sales/order-requests', icon: PackageSearch },
  { label: 'Products', href: '/sales/products', icon: Package },
  { label: 'Invoices', href: '/sales/invoices', icon: FileText },
];

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
    ],
  },
];

const SalesLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

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
