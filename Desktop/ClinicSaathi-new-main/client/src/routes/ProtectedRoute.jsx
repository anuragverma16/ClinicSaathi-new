import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { Spinner } from '../components/ui/States.jsx';
import { HOME_FOR_ROLE } from './nav.js';

/**
 * Route gate. This is UX only — the API authorises every request on its own.
 * A signed-in user who opens another role's area is sent to their own home.
 */
export function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6 text-pulse" /></div>;
  }
  if (!user) {
    const toPatient = location.pathname.startsWith('/patient');
    return <Navigate to={toPatient ? '/patient/login' : '/login'} state={{ from: location }} replace />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME_FOR_ROLE[user.role] || '/'} replace />;

  return children;
}
