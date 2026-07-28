import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, ArrowLeft, Package, FileText } from 'lucide-react';

const SalesLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const nav = [
    { label: 'Products', href: '/sales/products', icon: Package },
    { label: 'Invoices', href: '/sales/invoices', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-emerald-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-emerald-200 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="h-5 w-px bg-emerald-500" />
              <span className="font-semibold text-sm tracking-wide">Sales</span>
              <div className="flex items-center gap-1">
                {nav.map(({ label, href, icon: Icon }) => (
                  <Link
                    key={href}
                    to={href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === href
                        ? 'bg-white text-emerald-700'
                        : 'text-emerald-100 hover:bg-emerald-600'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-emerald-200 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-emerald-200 hover:text-white hover:bg-emerald-600 h-8 w-8 p-0"
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
