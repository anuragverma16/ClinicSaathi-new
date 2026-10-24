import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';

const COLLAPSE_KEY = 'cs.sidebarCollapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };

/** Persistent role sidebar + top bar around every authenticated page. */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const location = useLocation();

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* storage unavailable */ }
    return !c;
  });

  return (
    <div className="app-canvas flex h-screen overflow-hidden text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <div className="hidden lg:block"><Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} /></div>

      {/* Mobile drawer stays mounted so it can slide both ways. */}
      <div className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileOpen}>
        <div className={`absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
             onClick={() => setMobileOpen(false)} />
        <div className={`absolute left-0 top-0 h-full shadow-2xl transition-transform duration-300 ease-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar onNavigate={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} />
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main id="main" className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {/* Keyed by path so each page plays one short CSS entrance. */}
          <div key={location.pathname} className="page-in mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
