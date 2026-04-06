import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzeWallet } from '@/lib/analyzer';
import { isAddress, JsonRpcProvider } from 'ethers';

async function resolveAddress(input: string): Promise<string | null> {
    const trimmed: string = input.trim();
    // Already a valid 0x address
    if (isAddress(trimmed)) return trimmed.toLowerCase();
    // Try to resolve as ENS name (e.g., vitalik.eth)
    const ensName: string = trimmed;
    if (ensName.indexOf('.') !== -1) {
        try {
            const provider = new JsonRpcProvider(
                `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
            );
            const resolved = await provider.resolveName(ensName);
            return resolved ? resolved.toLowerCase() : null;
        } catch {
            return null;
        }
    }
    return null;
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { walletAddress } = body;

        if (!walletAddress || typeof walletAddress !== 'string') {
            return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
        }

        const addr = await resolveAddress(walletAddress);

        if (!addr) {
            return NextResponse.json({ error: 'Invalid Ethereum address or ENS name not found' }, { status: 400 });
        }

        // Check if we have a recent analysis (within 1 hour)
        const recentAnalysis = await prisma.walletAnalysis.findFirst({
            where: {
                walletAddress: addr,
                status: 'complete',
                startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            },
            orderBy: { startedAt: 'desc' },
        });

        if (recentAnalysis) {
            // return NextResponse.json({ analysisId: recentAnalysis.id, cached: true });
        }

        // Create new analysis record
        const analysis = await prisma.walletAnalysis.create({
            data: { walletAddress: addr },
        });

        // Run analysis in background so we return immediately
        analyzeWallet(analysis.id, addr).catch(e => console.error("Background analysis failed", e));

        return NextResponse.json({ analysisId: analysis.id, cached: false }, { status: 200 });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
