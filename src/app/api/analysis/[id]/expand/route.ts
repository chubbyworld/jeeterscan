import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzeWallet } from '@/lib/analyzer';

export async function POST(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const analysis = await prisma.walletAnalysis.findUnique({
            where: { id: params.id }
        });

        if (!analysis) {
            return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
        }

        if (analysis.status === 'processing' || analysis.status === 'pricing' || analysis.status === 'deep_scanning') {
            return NextResponse.json({ error: 'Scan currently active' }, { status: 400 });
        }

        analyzeWallet(analysis.id, analysis.walletAddress).catch(e => console.error(e));

        return NextResponse.json({ status: 'deep_scanning' });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
