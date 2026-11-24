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

      {/* Navigation */}
      {showNav && onNavigate && (
        <nav className="border-b border-dark-800 bg-dark-900/50">
          <div className="max-w-2xl mx-auto px-4 flex gap-1">
            {[
              { id: 'dashboard', label: 'Wallet' },
              { id: 'legacy', label: 'Legacy' },
              { id: 'receive', label: 'Receive' },
              { id: 'history', label: 'History' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => onNavigate(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeView === tab.id
                  ? tab.id === 'legacy' ? 'border-orange-500 text-orange-400' : 'border-nux-500 text-nux-400'
                  : 'border-transparent text-dark-400 hover:text-white'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
