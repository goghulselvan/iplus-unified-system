import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, User, Menu, X, ChevronDown, Settings, Calendar, MessageSquare, ArrowLeft } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function NavBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function useNavBadgeCounts() {
  return useQuery({
    queryKey: ['nav-badge-counts'],
    queryFn: async () => {
      const [{ count: portalPending }, { count: paymentPending }] = await Promise.all([
        supabase.from('school_portal_registrations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('portal_payment_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);
      return { portalPending: portalPending ?? 0, paymentPending: paymentPending ?? 0 };
    },
    refetchInterval: 30_000,
    staleTime: 0,
  });
}

const Navbar = () => {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { data: badges = { portalPending: 0, paymentPending: 0 } } = useNavBadgeCounts();

  useEffect(() => {
    if (!isMobile) setIsMobileMenuOpen(false);
  }, [isMobile]);

  const hasBulkWhatsApp = profile?.role === 'superadmin' || 
    !!(profile?.permissions as Record<string, boolean> | undefined)?.bulk_whatsapp;

  const coreNavigation = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Schools', href: '/schools' },
  ];

  const communicationNavigation = [
    { name: 'Communication Log', href: '/communication' },
    { name: 'Follow-ups',        href: '/follow-ups' },
    { name: 'Bulk Messaging',    href: '/marketing-messages' },
    { name: 'Voice Templates',   href: '/voice-templates' },
    { name: 'Incoming Calls',    href: '/incoming-calls' },
    { name: 'Address Labels',    href: '/address-labels' },
  ];

  const olympiadNavigation = [
    { name: 'Olympiad Management', href: '/olympiad-management', badge: 0 },
    { name: 'Exam Dates',          href: '/exam-dates',          badge: 0 },
    { name: 'Exam Slots',          href: '/exam-slot-publish',   badge: 0 },
    { name: 'Results',             href: '/results',             badge: 0 },
    { name: 'Link Schools',         href: '/portal-access',       badge: badges.portalPending },
    { name: 'Payment Queue',       href: '/payment-queue',       badge: badges.paymentPending },
  ];

  const accountantNavigation = [
    { name: 'Payment Dashboard', href: '/accountant' },
  ];

  const adminNavigation = [
    { name: 'Projects',            href: '/projects' },
    { name: 'Users',               href: '/users' },
    { name: 'Security',            href: '/security' },
    { name: 'Board Management',    href: '/board-management' },
    { name: 'Templates',           href: '/template-management' },
    { name: 'Data Management',     href: '/data-management' },
    { name: 'Accountant Dashboard', href: '/accountant' },
    { name: 'Admin Panel',         href: '/admin' },
  ];

  // For mobile menu - include all items
  const allNavigation = [
    ...(profile?.role === 'accountant' ? accountantNavigation : coreNavigation),
    ...communicationNavigation,
    ...olympiadNavigation,
    ...(profile?.role === 'superadmin' ? adminNavigation : []),
  ];

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <nav className="bg-primary text-primary-foreground shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <button
              onClick={() => navigate('/module-select')}
              className="flex items-center gap-2 bg-white/20 hover:bg-white/35 border border-white/30 text-primary-foreground text-sm font-semibold px-3 py-1.5 rounded-lg mr-4 transition-all"
            >
              <ArrowLeft className="h-4 w-4" />
              Modules
            </button>
            <Link to="/dashboard" className="flex items-center space-x-2">
              <div className="font-bold text-lg sm:text-xl">iPlus Olympiads</div>
            </Link>
            
            <div className="hidden md:flex space-x-4 lg:space-x-6 ml-8 items-center">
              {(profile?.role === 'accountant' ? accountantNavigation : coreNavigation).map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    location.pathname === item.href
                      ? 'bg-primary-foreground text-primary'
                      : 'hover:bg-primary/80'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
              
              {/* Communication Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 ${
                      communicationNavigation.some(item => location.pathname === item.href)
                        ? 'bg-primary-foreground text-primary'
                        : ''
                    }`}
                  >
                    <MessageSquare className="h-4 w-4 mr-1" />
                    Communication
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {communicationNavigation.map((item) => (
                    <DropdownMenuItem key={item.name} asChild>
                      <Link
                        to={item.href}
                        className={`w-full ${location.pathname === item.href ? 'bg-accent text-accent-foreground' : ''}`}
                      >
                        {item.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Olympiad Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 ${
                      olympiadNavigation.some(item => location.pathname === item.href)
                        ? 'bg-primary-foreground text-primary'
                        : ''
                    }`}
                  >
                    <Calendar className="h-4 w-4 mr-1" />
                    Olympiad
                    <NavBadge count={badges.portalPending + badges.paymentPending} />
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {olympiadNavigation.map((item) => (
                    <DropdownMenuItem key={item.name} asChild>
                      <Link
                        to={item.href}
                        className={`w-full flex items-center justify-between ${
                          location.pathname === item.href
                            ? 'bg-accent text-accent-foreground'
                            : ''
                        }`}
                      >
                        <span>{item.name}</span>
                        <NavBadge count={item.badge} />
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* Admin Dropdown */}
              {profile?.role === 'superadmin' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 ${
                        adminNavigation.some(item => location.pathname === item.href)
                          ? 'bg-primary-foreground text-primary'
                          : ''
                      }`}
                    >
                      <Settings className="h-4 w-4 mr-1" />
                      Admin
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {adminNavigation.map((item) => (
                      <DropdownMenuItem key={item.name} asChild>
                        <Link
                          to={item.href}
                          className={`w-full ${
                            location.pathname === item.href
                              ? 'bg-accent text-accent-foreground'
                              : ''
                          }`}
                        >
                          {item.name}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Desktop User Menu */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <User className="h-4 w-4" />
              <span className="text-sm">{profile?.username}</span>
              <span className="text-xs bg-primary-foreground text-primary px-2 py-1 rounded">
                {profile?.role}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-primary-foreground hover:bg-primary/80"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMobileMenu}
              className="text-primary-foreground hover:bg-primary/80"
            >
              {isMobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 bg-primary border-t border-primary-foreground/20">
              {allNavigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-colors ${
                    location.pathname === item.href
                      ? 'bg-primary-foreground text-primary'
                      : 'hover:bg-primary/80'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
              
              {/* Mobile User Info and Logout */}
              <div className="pt-4 border-t border-primary-foreground/20 mt-4">
                <div className="flex items-center space-x-2 px-3 py-2">
                  <User className="h-4 w-4" />
                  <span className="text-sm">{profile?.username}</span>
                  <span className="text-xs bg-primary-foreground text-primary px-2 py-1 rounded">
                    {profile?.role}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    signOut();
                    closeMobileMenu();
                  }}
                  className="w-full justify-start text-primary-foreground hover:bg-primary/80 mt-2"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;