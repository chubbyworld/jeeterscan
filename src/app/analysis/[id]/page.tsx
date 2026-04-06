'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import * as htmlToImage from 'html-to-image';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Share2,
} from 'lucide-react';
import DotGrid from '@/components/DotGrid';
import Navbar from '@/components/Navbar';
import WalletRoastCard from '@/components/WalletRoastCard';

interface NFTTrade {
  id: string;
  contractAddress: string;
  tokenId: string;
  collectionName: string;
  imageUrl: string | null;
  acquisitionType: string;
  acquisitionCostEth: number | null;
  buyTimestamp: string;
  sellPriceEth: number | null;
  sellTimestamp: string;
  heldDurationDays: number;
  peakPriceAfterSale: number | null;
  peakTimestamp: string | null;
  daysToPeak: number | null;
  missedProfitEth: number | null;
  confidence: string;
  pricingSource: string;
  pricingMode: string;
  openseaUrl: string;
}

interface Analysis {
  id: string;
  walletAddress: string;
  status: string;
  completedPairs: number;
  pricedTrades: number;
  confirmedMissedEth: number;
  confirmedMissedUsd: number;
  estimatedMissedEth: number;
  estimatedMissedUsd: number;
  maxRegretEth: number;
  maxRegretUsd: number;
  walletTradingVolume: number;
  walletTradingVolumeUsd: number;
  openseaFeesPaid: number;
  openseaFeesUsd: number;
  estimatedRoyaltyFeesPaid: number;
  estimatedRoyaltyFeesUsd: number;
  incomingTransfersScanned: number;
  outgoingTransfersScanned: number;
  collectionsAnalyzed: number;
  coverageLabel: string;
  earliestRelevantTradeDate: string;
  latestRelevantTradeDate: string;
  createdAt: string;
}

const POLL_INTERVAL = 3000;

function shortAddr(addr?: string | null) {
  if (!addr) return '';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtEth(n?: number | null) {
  if (n === null || n === undefined) return '---';
  if (n > 0 && n < 0.0001) return '< 0.0001 ETH';
  return `${n.toFixed(3)} ETH`;
}

function formatDur(days: number | null) {
  if (days === null) return 'Unknown hold window';
  if (days === 0) return '< 1 day';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function formatDate(date?: string | null) {
  if (!date) return 'Unknown';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
}

function getSeverity(totalMiss: number) {
  if (totalMiss > 50) return 'Catastrophic paperhands';
  if (totalMiss > 10) return 'Paperhands';
  if (totalMiss > 1) return 'Weak hands';
  if (totalMiss > 0) return 'Slightly weak hands';
  return 'Clean hands';
}

function getAcqLabel(trade: NFTTrade) {
  if (trade.acquisitionType === 'mint_free') return <span className="badge profit">Free mint</span>;
  if (trade.acquisitionType === 'mint_paid') return <span className="badge high">Paid mint</span>;
  return <span className="badge medium">Secondary buy</span>;
}

export default function AnalysisPage() {
  const params = useParams();
  const analysisId = params.id as string;
  const [data, setData] = useState<Analysis | null>(null);
  const [trades, setTrades] = useState<NFTTrade[]>([]);
  const [error, setError] = useState('');
  const [expandedCols, setExpandedCols] = useState<Record<string, boolean>>({});
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/analysis/${analysisId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load analysis');
        if (cancelled) return;

        setData(json.analysis);
        setTrades(json.trades || []);
        setError('');

        if (['processing', 'pricing'].includes(json.analysis.status)) {
          timeoutId = setTimeout(fetchData, POLL_INTERVAL);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Error occurred');
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [analysisId]);

  const paperhandTrades = useMemo(() => trades.filter((trade) => (trade.missedProfitEth || 0) > 0), [trades]);
  const sortedFumbles = useMemo(
    () => [...paperhandTrades].sort((a, b) => (b.missedProfitEth || 0) - (a.missedProfitEth || 0)),
    [paperhandTrades]
  );
  const top3 = useMemo(() => sortedFumbles.slice(0, 3), [sortedFumbles]);

  const groupedTrades = useMemo(() => {
    const map = new Map<string, NFTTrade[]>();
    for (const trade of paperhandTrades) {
      const key = trade.collectionName || trade.contractAddress;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(trade);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const maxA = Math.max(...a[1].map((item) => item.missedProfitEth || 0));
      const maxB = Math.max(...b[1].map((item) => item.missedProfitEth || 0));
      return maxB - maxA;
    });
  }, [paperhandTrades]);

  const shareText = useMemo(() => {
    if (!data) return '';
    return `I missed ${fmtEth(data.confirmedMissedEth)} by paperhanding NFTs too early.\n\nI traded ${fmtEth(
      data.walletTradingVolume
    )} in volume\nPaid ${fmtEth(data.openseaFeesPaid)} in fees on OpenSea\n\nTrack your fumbles.\nSee your real numbers.\n\nCheck your wallet on Jeeter\nhttps://jeeterscan.xyz`;
  }, [data]);

  const toggleGroup = (key: string) => {
    setExpandedCols((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopy = async () => {
    if (!shareText) return;
    await navigator.clipboard.writeText(shareText);
    alert('Copied to clipboard');
  };

  const handleTwitterShare = () => {
    if (!shareText) return;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleDownloadImg = async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await htmlToImage.toPng(cardRef.current, {
        style: { transform: 'scale(1)', margin: '0' },
      });
      const link = document.createElement('a');
      link.download = `jeeter-${data?.walletAddress || 'roast'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Image generation failed', err);
    }
  };

  if (error && !data) {
    return (
      <main className="container" style={{ padding: '120px 0 80px' }}>
        <div className="error-box">
          <span>Warning</span>
          <span>{error}</span>
        </div>
        <Link href="/" className="back-link">
          Back home
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={{ minHeight: '100vh', position: 'relative' }}>
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, opacity: 0.42 }}>
          <DotGrid
            dotSize={5}
            gap={15}
            baseColor="#f8f4ec"
            activeColor="#5fd5b3"
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
        <div className="container loading-wrapper" style={{ position: 'relative', zIndex: 1 }}>
          <div className="loader">
            <div className="loaderMiniContainer">
              <div className="barContainer">
                <span className="bar" />
                <span className="bar bar2" />
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 101 114" className="svgIcon">
                <circle
                  cx="46.1726"
                  cy="46.1727"
                  r="29.5497"
                  transform="rotate(36.0692 46.1726 46.1727)"
                  stroke="var(--accent)"
                  strokeWidth="7"
                />
                <line x1="61.7089" y1="67.7837" x2="97.7088" y2="111.784" stroke="var(--accent)" strokeWidth="7" />
              </svg>
            </div>
          </div>
          <div className="loading-title">Rebuilding the wallet timeline</div>
          <p className="loading-sub">
            Jeeter is pairing exits, pricing each trade, and calculating what happened after you sold.
          </p>
        </div>
      </main>
    );
  }

  const hasData = trades.length > 0;
  const isDone = ['complete', 'partial', 'failed'].includes(data.status);
  const severity = getSeverity(data.confirmedMissedEth || 0);

  return (
    <main style={{ minHeight: '100vh', position: 'relative', paddingBottom: 96 }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, opacity: 0.42 }}>
        <DotGrid
          dotSize={5}
          gap={15}
          baseColor="#f8f4ec"
          activeColor="#5fd5b3"
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

      <Navbar walletLabel={shortAddr(data.walletAddress)} />

      <div className="container" style={{ position: 'relative', zIndex: 1, paddingTop: 34 }}>
        <section className="page-hero animate-in">
          <div className="eyebrow">Analysis report</div>
          <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
            <h1 className="page-title">
              Wallet regret score: <span className="gradient-text">{severity}</span>
            </h1>
            <p className="page-subtitle">
              Tracking window {formatDate(data.earliestRelevantTradeDate)} to {formatDate(data.latestRelevantTradeDate)}.
              {` `}
              {data.collectionsAnalyzed} collections analyzed and {data.completedPairs} paired trades processed.
            </p>
          </div>
        </section>

        {!isDone ? (
          <section
            className="glass-panel animate-in delay-1"
            style={{
              borderRadius: '30px',
              padding: '28px',
              display: 'grid',
              gap: 20,
              marginBottom: 28,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div className="section-title" style={{ fontSize: '1.45rem' }}>
                  Analysis in progress
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  {data.pricedTrades} trades priced so far. Leave this tab open while the report finishes.
                </div>
              </div>
              <div className="loader">
                <div className="loaderMiniContainer">
                  <div className="barContainer">
                    <span className="bar" />
                    <span className="bar bar2" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {data.status === 'failed' ? (
          <div className="error-box" style={{ marginBottom: 24 }}>
            <span>Warning</span>
            <span>Analysis encountered a fatal error. Results may be incomplete.</span>
          </div>
        ) : null}

        {!hasData && isDone ? (
          <div className="empty-state">
            <div className="icon">Clear</div>
            <h2 style={{ margin: 0, fontSize: '1.6rem' }}>No paperhands detected</h2>
            <p className="page-subtitle" style={{ marginTop: 10 }}>
              Either this wallet held through the volatility or there were no relevant NFT exits to score.
            </p>
          </div>
        ) : null}

        {hasData ? (
          <div style={{ display: 'grid', gap: 34 }}>
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 24,
                alignItems: 'start',
              }}
            >
              <div className="glass-panel animate-in delay-1" style={{ borderRadius: '34px', padding: '28px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div className="section-header" style={{ marginBottom: 0 }}>
                    <h2 className="section-title">Shareable roast card</h2>
                    <span className="muted" style={{ fontSize: '0.9rem' }}>
                      Coverage: {data.coverageLabel || 'Forensic'}
                    </span>
                  </div>
                  <div
                    ref={cardRef}
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      overflow: 'auto',
                      padding: '6px 0',
                    }}
                  >
                    <WalletRoastCard
                      wallet={shortAddr(data.walletAddress)}
                      missedEth={data.confirmedMissedEth ?? 0}
                      nftCount={paperhandTrades.length}
                      rating={severity}
                      nftVolume={data.walletTradingVolume ?? null}
                      feesPaid={data.openseaFeesPaid ?? null}
                      topNftImage={sortedFumbles[0]?.imageUrl ?? null}
                      topNftName={sortedFumbles[0]?.collectionName ?? null}
                      topNftMissedEth={sortedFumbles[0]?.missedProfitEth ?? null}
                    />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <button
                      type="button"
                      onClick={handleTwitterShare}
                      className="btn-primary"
                      style={{ padding: '14px 20px', display: 'inline-flex', alignItems: 'center', gap: 10 }}
                    >
                      <Share2 size={18} />
                      Share on X
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="btn-secondary"
                      style={{ padding: '14px 18px', display: 'inline-flex', alignItems: 'center', gap: 10 }}
                    >
                      <Copy size={18} />
                      Copy text
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadImg}
                      className="btn-secondary"
                      style={{ padding: '14px 18px', display: 'inline-flex', alignItems: 'center', gap: 10 }}
                    >
                      <Download size={18} />
                      Download image
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 16 }}>
                <div className="stats-grid animate-in delay-2">
                  <div className="card stat-card">
                    <div className="stat-value red">{fmtEth(data.confirmedMissedEth)}</div>
                    <div className="stat-label">Confirmed missed</div>
                    <div className="stat-copy">High-confidence upside that happened after the wallet sold.</div>
                  </div>
                  <div className="card stat-card">
                    <div className="stat-value blue">{fmtEth(data.walletTradingVolume)}</div>
                    <div className="stat-label">Wallet volume</div>
                    <div className="stat-copy">Total NFT trading volume reconstructed from this wallet&apos;s activity.</div>
                  </div>
                  <div className="card stat-card">
                    <div className="stat-value warm">{fmtEth(data.openseaFeesPaid)}</div>
                    <div className="stat-label">OpenSea fees paid</div>
                    <div className="stat-copy">Direct platform fee drag from the wallet&apos;s NFT trading activity.</div>
                  </div>
                  <div className="card stat-card">
                    <div className="stat-value mint">{paperhandTrades.length}</div>
                    <div className="stat-label">Paperhand exits</div>
                    <div className="stat-copy">Trades where the wallet sold before the real upside materialized.</div>
                  </div>
                </div>

                <div className="glass-panel animate-in delay-3" style={{ borderRadius: '30px', padding: '24px' }}>
                  <div className="section-title" style={{ fontSize: '1.35rem', marginBottom: 16 }}>
                    Wallet context
                  </div>
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      <span className="muted">Wallet volume</span>
                      <strong>{fmtEth(data.walletTradingVolume)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      <span className="muted">Estimated royalty fees</span>
                      <strong>{fmtEth(data.estimatedRoyaltyFeesPaid)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      <span className="muted">Collections analyzed</span>
                      <strong>{data.collectionsAnalyzed}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      <span className="muted">Transfers scanned</span>
                      <strong>{data.outgoingTransfersScanned}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {top3.length > 0 ? (
              <section className="animate-in delay-1">
                <div className="section-header">
                  <h2 className="section-title">Top fumbles</h2>
                  <span className="muted">Worst exits ranked by missed ETH</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  {top3.map((item, index) => (
                    <div key={item.id} className="glass-panel" style={{ borderRadius: '26px', padding: '22px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                        <div>
                          <div className="badge missed">#{index + 1} regret spot</div>
                          <div
                            style={{
                              fontFamily: "'Space Grotesk', sans-serif",
                              fontSize: '1.2rem',
                              fontWeight: 700,
                              marginTop: 12,
                            }}
                          >
                            {item.collectionName || shortAddr(item.contractAddress)}
                          </div>
                          <div className="muted" style={{ marginTop: 6 }}>
                            Token {shortAddr(item.tokenId)} • Held {formatDur(item.heldDurationDays)}
                          </div>
                        </div>
                        <div
                          style={{
                            width: 60,
                            height: 60,
                            borderRadius: 18,
                            overflow: 'hidden',
                            flexShrink: 0,
                            background: 'rgba(33,118,216,0.12)',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <ImageIcon size={20} color="var(--accent)" />
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span className="muted">Sold for</span>
                          <strong>{fmtEth(item.sellPriceEth)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span className="muted">Peak after sale</span>
                          <strong>{fmtEth(item.peakPriceAfterSale)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span className="muted">Confidence</span>
                          <span className={`badge ${item.confidence?.toLowerCase() || 'medium'}`}>{item.confidence}</span>
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            paddingTop: 14,
                            borderTop: '1px solid rgba(77,112,147,0.14)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 16,
                            color: 'var(--danger)',
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>Missed profit</span>
                          <strong>{fmtEth(item.missedProfitEth)}</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="animate-in delay-2">
              <div className="section-header">
                <h2 className="section-title">All fumbles by collection</h2>
                <span className="muted">{paperhandTrades.length} NFTs flagged</span>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {groupedTrades.map(([collectionName, list]) => {
                  const expanded = expandedCols[collectionName];
                  const totalGroupMiss = list.reduce((sum, trade) => sum + (trade.missedProfitEth || 0), 0);

                  return (
                    <div key={collectionName} className="glass-panel" style={{ borderRadius: '24px', overflow: 'hidden' }}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(collectionName)}
                        style={{
                          width: '100%',
                          border: 'none',
                          background: expanded ? 'var(--bg-soft)' : 'transparent',
                          color: 'inherit',
                          padding: '18px 20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          <div style={{ minWidth: 0, textAlign: 'left' }}>
                            <div
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: '1.05rem',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {collectionName}
                            </div>
                            <div className="muted" style={{ marginTop: 4, fontSize: '0.86rem' }}>
                              {list.length} NFTs with measurable regret
                            </div>
                          </div>
                        </div>
                        <div style={{ color: 'var(--danger)', fontWeight: 800 }}>{fmtEth(totalGroupMiss)}</div>
                      </button>

                      {expanded ? (
                        <div className="table-wrapper" style={{ borderTop: '1px solid rgba(77,112,147,0.12)' }}>
                          <table style={{ minWidth: 840 }}>
                            <thead>
                              <tr>
                                <th>NFT</th>
                                <th>Acquisition</th>
                                <th>Cost</th>
                                <th>Sold for</th>
                                <th>Peak after</th>
                                <th>Missed</th>
                                <th>Link</th>
                              </tr>
                            </thead>
                            <tbody>
                              {list.map((trade) => {
                                const url =
                                  trade.openseaUrl ||
                                  (trade.contractAddress
                                    ? `https://opensea.io/assets/ethereum/${trade.contractAddress}/${trade.tokenId}`
                                    : null);

                                return (
                                  <tr key={trade.id}>
                                    <td>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div
                                          style={{
                                            width: 42,
                                            height: 42,
                                            borderRadius: 14,
                                            overflow: 'hidden',
                                            background: 'rgba(33,118,216,0.12)',
                                            display: 'grid',
                                            placeItems: 'center',
                                            flexShrink: 0,
                                          }}
                                        >
                                          {trade.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              src={trade.imageUrl}
                                              alt={trade.collectionName || trade.tokenId}
                                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                          ) : (
                                            <ImageIcon size={18} color="var(--accent)" />
                                          )}
                                        </div>
                                        <div>
                                          <div style={{ color: 'var(--text)', fontWeight: 700 }}>
                                            {trade.collectionName || shortAddr(trade.contractAddress)}
                                          </div>
                                          <div className="muted" style={{ fontSize: '0.84rem', marginTop: 4 }}>
                                            Token {shortAddr(trade.tokenId)}
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td>{getAcqLabel(trade)}</td>
                                    <td>{trade.acquisitionCostEth != null ? fmtEth(trade.acquisitionCostEth) : '---'}</td>
                                    <td>{fmtEth(trade.sellPriceEth)}</td>
                                    <td>{fmtEth(trade.peakPriceAfterSale)}</td>
                                    <td style={{ color: 'var(--danger)', fontWeight: 800 }}>{fmtEth(trade.missedProfitEth)}</td>
                                    <td>
                                      {url ? (
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            color: 'var(--accent)',
                                            textDecoration: 'none',
                                            fontWeight: 700,
                                          }}
                                        >
                                          OpenSea
                                          <ExternalLink size={14} />
                                        </a>
                                      ) : (
                                        '---'
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
