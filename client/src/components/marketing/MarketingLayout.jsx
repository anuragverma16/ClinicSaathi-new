import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MarketingHeader } from './MarketingHeader.jsx';
import { MarketingFooter } from './MarketingFooter.jsx';
import { Preloader } from './Preloader.jsx';
import { pageEnter } from '../../animations/gsapUtils.js';

export function MarketingLayout() {
  const mainRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    pageEnter(mainRef.current);
    if (location.hash) {
      // Give the route's own content a tick to mount before scrolling to it.
      requestAnimationFrame(() => {
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
      });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [location.pathname, location.hash]);

  return (
    <div className="theme-dark min-h-screen bg-paper text-ink">
      <Preloader />
      <MarketingHeader />
      <main ref={mainRef}>
        <Outlet />
      </main>
      <MarketingFooter />
    </div>
  );
}
