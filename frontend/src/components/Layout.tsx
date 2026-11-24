import React from 'react';
import logo from '../assets/logo.png';
import type { Theme } from '../lib/theme';

interface LayoutProps {
  children: React.ReactNode;
  address?: string | null;
  onLock?: () => void;
  onLogout?: () => void;
  showNav?: boolean;
  activeView?: string;
  onNavigate?: (view: string) => void;
  theme?: Theme;
  onToggleTheme?: () => void;
}

export function Layout({
  children,
  address,
  onLock,
  onLogout,
  showNav,
  activeView,
  onNavigate,
  theme,
  onToggleTheme,
}: LayoutProps) {
  return (
    <div className="min-h-screen bg-dark-950">
      {/* Header */}
      <header className="border-b border-dark-800 bg-dark-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Nusacoin" className="w-9 h-9 rounded-lg" />
            <span className="font-bold text-lg">Nusacoin</span>
          </div>

          <div className="flex items-center gap-2">
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className="p-2 rounded-lg text-dark-400 hover:text-ink hover:bg-dark-800 transition-colors"
                title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                aria-label="Toggle theme"
              >
                {theme === 'light' ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M20.25 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                  </svg>
                )}
              </button>
            )}

            {address && (
              <>
                <button
                  onClick={onLock}
                  className="text-sm text-dark-400 hover:text-ink transition-colors px-3 py-1.5 rounded-lg hover:bg-dark-800"
                  title="Lock wallet"
                >
                  Lock
                </button>
                <button
                  onClick={onLogout}
                  className="text-sm text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-dark-800"
                  title="Delete wallet from this browser"
                >
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Bottom navigation: thumb-friendly and PWA-app-like. The pill
          floats above the content; main carries bottom padding so the
          last content is never hidden behind it. The outer nav ignores
          pointer events outside the pill, so it never blocks taps on
          wide screens. Legacy keeps its orange active state, marking
          the deprecated area. */}
      {showNav && onNavigate && (
        <nav className="fixed bottom-0 inset-x-0 z-50 pb-4 pointer-events-none">
          <div className="max-w-2xl mx-auto px-4 pointer-events-auto">
            <div className="flex rounded-3xl border border-dark-700 bg-dark-900/90 backdrop-blur shadow-2xl p-1.5 gap-1">
              {[
                {
                  id: 'dashboard', label: 'Wallet',
                  icon: (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                    </svg>
                  ),
                },
                {
                  id: 'legacy', label: 'Legacy',
                  icon: (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                    </svg>
                  ),
                },
                {
                  id: 'receive', label: 'Receive',
                  icon: (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  ),
                },
                {
                  id: 'history', label: 'History',
                  icon: (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onNavigate(tab.id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-2xl text-[11px] font-medium transition-colors ${activeView === tab.id
                    ? tab.id === 'legacy' ? 'bg-orange-500/10 text-orange-400' : 'bg-nux-500/10 text-nux-400'
                    : 'text-dark-400 hover:text-ink'
                    }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </nav>
      )}

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 pt-8 pb-28">{children}</main>
    </div>
  );
}
