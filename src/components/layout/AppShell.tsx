'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { Topbar } from './Topbar';
import { ContextBanners } from './ContextBanners';

const STORAGE_KEY = 'venzo:sidebar-collapsed';

type Variant = 'mobile' | 'tablet' | 'desktop';

function detectVariant(): Variant {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'mobile';
}

/**
 * AppShell — Sprint 14 (P5).
 *
 * 3 zonas:
 *   - desktop ≥ 1024px → Sidebar fixed 240/56 + Topbar 56 + content
 *   - tablet 768–1023  → Sidebar overlay + Topbar 56 (hamburger) + content
 *   - mobile  < 768    → Topbar 48 + content + BottomNav
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [variant, setVariant] = useState<Variant>('desktop');
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    setVariant(detectVariant());
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');

    const onResize = () => setVariant(detectVariant());
    window.addEventListener('resize', onResize);

    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapsed();
      } else if (e.key === 'Escape' && overlayOpen) {
        setOverlayOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOpen]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  const sidebarVariant = variant === 'desktop' ? 'fixed' : 'overlay';
  const mainOffset =
    variant === 'desktop' ? (collapsed ? 'lg:ml-14' : 'lg:ml-60') : '';

  return (
    <>
      <Sidebar
        variant={sidebarVariant}
        open={variant === 'tablet' && overlayOpen}
        onClose={() => setOverlayOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className={`min-h-screen ${mainOffset}`}>
        <Topbar
          variant={variant}
          onOpenMenu={() => setOverlayOpen(true)}
        />
        <ContextBanners />
        <main id="main-content" className="px-4 md:px-6 py-4 md:py-6">
          {children}
        </main>
      </div>
      {variant === 'mobile' && <BottomNav />}
    </>
  );
}
