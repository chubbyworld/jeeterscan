'use client';

import React from 'react';

interface WalletRoastCardProps {
    wallet: string;
    missedEth: number;
    nftCount: number;
    rating: string;
    nftVolume?: number | null;
    feesPaid?: number | null;
    topNftImage?: string | null;
    topNftName?: string | null;
    topNftMissedEth?: number | null;
}

function fmtEth(n: number) {
    return `${n.toFixed(3)} ETH`;
}

function getRatingColor(rating: string) {
    const r = rating.toLowerCase();
    if (r.includes('catastrophic')) return '#ef4444';
    if (r.includes('paperhands') && !r.includes('slightly')) return '#f97316';
    if (r.includes('weak')) return '#eab308';
    return '#22c55e';
}

function Sparkle({ style }: { style?: React.CSSProperties }) {
    return (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={style}>
            <path d="M11 0 L12.2 9.8 L22 11 L12.2 12.2 L11 22 L9.8 12.2 L0 11 L9.8 9.8 Z" fill="white" />
        </svg>
    );
}

export default function WalletRoastCard({
    wallet,
    missedEth,
    nftCount,
    rating,
    nftVolume,
    feesPaid,
    topNftImage,
    topNftName,
    topNftMissedEth,
}: WalletRoastCardProps) {
    const ratingColor = getRatingColor(rating);
    const hasMetrics = nftVolume != null || feesPaid != null;

    return (
        <div
            style={{
                width: 480,
                height: 480,
                borderRadius: 28,
                overflow: 'hidden',
                position: 'relative',
                fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
                flexShrink: 0,
            }}
        >
            {/* Background image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src="/pepe-card-bg.png"
                alt=""
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                }}
            />

            {/* Overlay for text contrast */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                        'radial-gradient(ellipse 70% 60% at 80% 20%, rgba(255,255,255,0.18) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }}
            />

            {/* Sparkles */}
            <Sparkle style={{ position: 'absolute', top: '22%', left: '42%', opacity: 0.95 }} />
            <Sparkle style={{ position: 'absolute', top: '52%', left: '60%', width: 14, height: 14, opacity: 0.85 }} />

            {/* ── Top bar: brand + rating badge ── */}
            <div
                style={{
                    position: 'absolute',
                    top: 28,
                    left: 28,
                    right: 28,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <div style={{ fontWeight: 800, fontSize: '1.3rem', color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.25)', letterSpacing: '-0.5px' }}>
                    Paperhand.
                </div>
                <div style={{
                    background: 'rgba(255,255,255,0.22)',
                    backdropFilter: 'blur(12px)',
                    border: `1.5px solid ${ratingColor}`,
                    color: ratingColor,
                    padding: '5px 14px',
                    borderRadius: 999,
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                }}>
                    {rating}
                </div>
            </div>

            {/* ── RIGHT COLUMN: single unified flex column ── */}
            {/* Spans from below the top bar to above the footer */}
            <div
                style={{
                    position: 'absolute',
                    top: 80,
                    right: 28,
                    bottom: 64,   // stays above the wallet/jeeter footer
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    textAlign: 'right',
                    justifyContent: 'space-between',
                }}
            >
                {/* ── SECTION 1: Missed profit ── */}
                <div>
                    <div style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(30,50,80,0.65)',
                        marginBottom: 6,
                    }}>
                        Confirmed Missed
                    </div>
                    <div style={{
                        fontSize: '3rem',
                        fontWeight: 800,
                        color: '#1a3a6b',
                        lineHeight: 1,
                        textShadow: '0 2px 12px rgba(0,0,0,0.08)',
                    }}>
                        {fmtEth(missedEth)}
                    </div>
                    <div style={{ marginTop: 8, fontSize: '0.88rem', color: 'rgba(30,50,80,0.55)', fontWeight: 500 }}>
                        across{' '}
                        <span style={{ color: '#1a3a6b', fontWeight: 700 }}>
                            {nftCount} NFT{nftCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>

                {/* ── SECTION 2: Top Fumble NFT image (only if image exists) ── */}
                {topNftImage && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        <div style={{
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(30,50,80,0.5)',
                        }}>
                            Top Fumble
                        </div>
                        {/* Image */}
                        <div style={{
                            width: 112,
                            height: 112,
                            borderRadius: 16,
                            overflow: 'hidden',
                            border: '2px solid rgba(255,255,255,0.6)',
                            boxShadow: '0 8px 28px rgba(0,0,0,0.2)',
                            background: 'rgba(255,255,255,0.15)',
                            flexShrink: 0,
                        }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={topNftImage}
                                alt={topNftName || 'Top papered NFT'}
                                crossOrigin="anonymous"
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                        </div>
                    </div>
                )}

                {/* ── SECTION 3: Divider + NFT Volume / Fees Paid ── */}
                {hasMetrics && (
                    <div style={{ width: '100%' }}>
                        {/* Divider */}
                        <div style={{
                            height: 1,
                            background: 'rgba(30,50,80,0.12)',
                            marginBottom: 10,
                            width: '100%',
                        }} />
                        {/* Metrics row */}
                        <div style={{ display: 'flex', gap: 20, justifyContent: 'flex-end' }}>
                            {nftVolume != null && (
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{
                                        fontSize: '0.6rem',
                                        fontWeight: 700,
                                        letterSpacing: '0.1em',
                                        textTransform: 'uppercase',
                                        color: 'rgba(30,50,80,0.5)',
                                        marginBottom: 3,
                                    }}>
                                        NFT Volume
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1a3a6b', lineHeight: 1 }}>
                                        {nftVolume.toFixed(2)} ETH
                                    </div>
                                </div>
                            )}
                            {feesPaid != null && (
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{
                                        fontSize: '0.6rem',
                                        fontWeight: 700,
                                        letterSpacing: '0.1em',
                                        textTransform: 'uppercase',
                                        color: 'rgba(30,50,80,0.5)',
                                        marginBottom: 3,
                                    }}>
                                        Fees Paid
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#b45309', lineHeight: 1 }}>
                                        {feesPaid.toFixed(3)} ETH
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Bottom footer: wallet address + brand ── */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 24,
                    right: 28,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 4,
                }}
            >
                <div style={{
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    color: 'rgba(30,50,80,0.55)',
                    background: 'rgba(255,255,255,0.35)',
                    backdropFilter: 'blur(8px)',
                    padding: '4px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.4)',
                }}>
                    {wallet}
                </div>
                <div style={{
                    fontSize: '0.65rem',
                    letterSpacing: '0.1em',
                    color: 'rgba(30,50,80,0.4)',
                    textTransform: 'uppercase',
                }}>
                    jeeterscan.xyz
                </div>
            </div>
        </div>
    );
}
