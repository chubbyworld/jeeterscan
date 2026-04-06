'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search } from 'lucide-react';
import DotGrid from '@/components/DotGrid';
import Navbar from '@/components/Navbar';

const statItems = [
  { value: '5+ years', label: 'Wallet history depth' },
  { value: 'Full ETH flow', label: 'Buy, sell, fee tracking' },
  { value: 'Collection peaks', label: 'Missed upside after exit' },
];

export default function HomePage() {
  const router = useRouter();
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');

  const runFullWalletAnalysis = async (walletAddress: string) => {
    setProgress(5);
    setProgressMessage('Initializing wallet scan');

    const res = await fetch('/api/analyze-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start analysis');

    const analysisId = data.analysisId;
    setProgress(15);
    setProgressMessage('Fetching wallet transaction history');

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const pollRes = await fetch(`/api/analysis/${analysisId}`);
      const pollData = await pollRes.json();

      if (!pollRes.ok) throw new Error(pollData.error || 'Failed to check status');

      const analysis = pollData.analysis;
      const status = analysis.status;
      const priced = analysis.pricedTrades || 0;

      if (status === 'complete' || status === 'partial') {
        setProgress(100);
        setProgressMessage('Preparing report');
        await new Promise((resolve) => setTimeout(resolve, 400));
        return analysisId;
      }

      if (status === 'failed') {
        throw new Error(analysis.errorMessage || 'Analysis failed internally');
      }

      if (status === 'processing') {
        if (analysis.outgoingTransfersScanned > 0) {
          setProgress(34);
          setProgressMessage('Detecting NFT transfer pairs');
        } else {
          setProgress(18);
          setProgressMessage('Collecting raw transaction history');
        }
      } else if (status === 'pricing') {
        if (priced === 0) {
          setProgress(52);
          setProgressMessage('Identifying NFT exits');
        } else {
          const ratio = Math.min(priced / Math.max(20, priced), 1);
          const percent = 62 + Math.floor(ratio * 30);
          setProgress(percent);

          if (percent > 84) {
            setProgressMessage('Finalizing missed-profit report');
          } else if (percent > 76) {
            setProgressMessage('Calculating volume and fee drag');
          } else {
            setProgressMessage('Measuring upside after each sale');
          }
        }
      }
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!wallet.trim() || loading) return;

    setError('');
    setLoading(true);

    try {
      const finalAnalysisId = await runFullWalletAnalysis(wallet.trim());
      router.push(`/analysis/${finalAnalysisId}`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setLoading(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  return (
    <main style={{ minHeight: '100vh', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, opacity: 0.5 }}>
        <DotGrid
          dotSize={5}
          gap={15}
          baseColor="rgba(255,255,255,0.28)"
          activeColor="rgba(255,255,255,0.58)"
          proximity={170}
          speedTrigger={60}
          shockRadius={250}
          shockStrength={5}
          maxSpeed={8000}
          resistance={1450}
          returnDuration={3.3}
          style={{}}
        />
      </div>

      <Navbar />

      <section className="container" style={{ position: 'relative', zIndex: 1, padding: '78px 0 120px' }}>
        <div
          className="glass-panel animate-in"
          style={{
            borderRadius: '40px',
            padding: '42px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div className="eyebrow">Wallet regret engine</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <h1 className="hero-title">check how paperhand you are</h1>
              <p className="hero-subtitle">
                Jeeter scans your Ethereum wallet, reconstructs buy and sell pairs, then checks what happened after
                you exited so the missed upside is impossible to ignore.
              </p>
            </div>

            <form
              className="animate-in delay-1"
              onSubmit={handleSubmit}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 12,
                padding: 12,
                borderRadius: '28px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <label
                htmlFor="wallet-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0 10px 0 14px',
                  minWidth: 0,
                }}
              >
                <Search size={20} color="var(--accent)" />
                <input
                  id="wallet-input"
                  type="text"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="Paste 0x wallet or ENS"
                  disabled={loading}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--text)',
                    fontSize: '1rem',
                  }}
                />
              </label>
              <button
                id="analyze-btn"
                type="submit"
                className="btn-primary"
                disabled={loading || !wallet.trim()}
                style={{
                  padding: '16px 24px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  fontWeight: 800,
                }}
              >
                {loading ? 'Scanning wallet' : 'Analyze wallet'}
                <ArrowRight size={18} />
              </button>
            </form>

            {loading ? (
              <div
                className="animate-in delay-2"
                style={{
                  padding: '22px 24px',
                  borderRadius: '26px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  gap: 16,
                }}
              >
                <div
                  style={{
                    height: 10,
                    borderRadius: 999,
                    overflow: 'hidden',
                    background: 'rgba(73, 97, 125, 0.14)',
                  }}
                >
                  <div
                    style={{
                      width: `${progress}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: 'linear-gradient(135deg, var(--accent), var(--accent-mint))',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 800, color: 'var(--accent-strong)' }}>{progressMessage}</div>
                    <div className="muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                      Deep scans can take a minute if the wallet has years of activity.
                    </div>
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '1.1rem', fontWeight: 700 }}>
                    {progress}%
                  </div>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="error-box animate-in delay-2">
                <span>Warning</span>
                <span>{error}</span>
              </div>
            ) : null}

            <div
              className="animate-in delay-3"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}
            >
              {statItems.map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: '18px 16px',
                    borderRadius: '22px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: '1.28rem',
                      fontWeight: 700,
                      letterSpacing: '-0.05em',
                      marginBottom: 6,
                    }}
                  >
                    {item.value}
                  </div>
                  <div className="muted" style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
