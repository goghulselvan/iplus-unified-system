import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, ArrowLeft, LayoutDashboard, Package, FileText, Truck, ClipboardList, PackageMinus, ArrowUpDown, BarChart3, FileBarChart } from 'lucide-react';

const SalesLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const nav = [
    { label: 'Dashboard', href: '/sales/dashboard', icon: LayoutDashboard },
    { label: 'Products', href: '/sales/products', icon: Package },
    { label: 'Invoices', href: '/sales/invoices', icon: FileText },
    { label: 'Suppliers', href: '/sales/suppliers', icon: Truck },
    { label: 'Purchase Orders', href: '/sales/purchase-orders', icon: ClipboardList },
    { label: 'Stock Movements', href: '/sales/stock-movements', icon: ArrowUpDown },
    { label: 'Item Issue', href: '/sales/item-issue', icon: PackageMinus },
    { label: 'Stock Report', href: '/sales/stock-report', icon: BarChart3 },
    { label: 'Purchase Report', href: '/sales/purchase-report', icon: FileBarChart },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <nav className="bg-white text-neutral-900 shadow-sm border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 text-sm transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="h-5 w-px bg-neutral-200" />
              <span className="font-semibold text-sm tracking-wide text-neutral-900">Sales</span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {nav.map(({ label, href, icon: Icon }) => (
                  <Link
                    key={href}
                    to={href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      location.pathname === href
                        ? 'bg-orange-50 text-orange-700'
                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-neutral-500 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 h-8 w-8 p-0"
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
