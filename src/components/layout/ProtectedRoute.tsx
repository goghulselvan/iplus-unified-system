import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
  accountantOnly?: boolean;
  requiredPermission?: string;
}

const ProtectedRoute = ({ children, adminOnly = false, accountantOnly = false, requiredPermission }: ProtectedRouteProps) => {
  const { user, session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !session) {
    return <Navigate to="/auth" replace />;
  }

  if (session.expires_at && session.expires_at < Date.now() / 1000) {
    return <Navigate to="/auth" replace />;
  }

  if (adminOnly && profile?.role !== 'superadmin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (accountantOnly && profile?.role !== 'accountant' && profile?.role !== 'superadmin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredPermission && profile?.role !== 'superadmin') {
    const perms = profile?.permissions as Record<string, boolean> | undefined;
    if (!perms?.[requiredPermission]) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;