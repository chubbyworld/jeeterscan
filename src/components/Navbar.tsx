'use client';

import Link from 'next/link';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

interface NavbarProps {
  walletLabel?: string | null;
}

export default function Navbar({ walletLabel }: NavbarProps) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored === 'dark' || (!stored && prefersDark);
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const handleCheckWallet = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
      e.preventDefault();
      document.getElementById('wallet-input')?.focus();
    }
  };

  return (
    <nav className="navbar">
      <Link href="/" className="nav-brand">
        <div className="nav-mark">J</div>
        <div className="nav-copy">
          <span className="logo">Jeeter</span>
          <span className="logo-tagline">NFT paperhands checker for Ethereum wallets</span>
        </div>
      </Link>

      <div className="nav-actions">
        {walletLabel ? <div className="nav-wallet">{walletLabel}</div> : null}
        <button type="button" onClick={toggleDark} className="nav-icon-btn" aria-label="Toggle color theme">
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <Link href="/" onClick={handleCheckWallet} className="navbar-btn">
          Check Wallet
        </Link>
      </div>
    </nav>
  );
}
