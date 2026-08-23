import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  LogOut, ArrowLeft, LayoutDashboard, Wallet, Truck, AlertCircle, Trash2, FileText, ExternalLink,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: '/accounts/dashboard', icon: LayoutDashboard },
  { label: 'Payments', href: '/accounts/payments', icon: Wallet },
  { label: 'Supplier Payments', href: '/accounts/supplier-payments', icon: Truck },
  { label: 'Outstanding', href: '/accounts/outstanding', icon: AlertCircle },
  { label: 'Deleted Payments', href: '/accounts/deleted-payments', icon: Trash2 },
];

const AccountsLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const linkClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-white text-emerald-700'
        : 'text-emerald-100 hover:bg-emerald-700 hover:text-white'
    }`;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <nav className="bg-emerald-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-emerald-100 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="h-5 w-px bg-emerald-400" />
              <span className="font-semibold text-sm tracking-wide text-white">Accounts</span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {navItems.map(({ label, href, icon: Icon }) => (
                  <Link key={href} to={href} className={linkClass(location.pathname === href)}>
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                ))}
                <a
                  href="/sales/credit-notes"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap text-emerald-100 hover:bg-emerald-700 hover:text-white transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Credit Notes & Refunds
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </a>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-emerald-100 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-emerald-100 hover:text-white hover:bg-emerald-700 h-8 w-8 p-0"
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

export default AccountsLayout;
