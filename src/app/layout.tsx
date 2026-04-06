import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jeeter | NFT Paperhands Checker',
  description:
    'Analyze any Ethereum wallet to see exactly how much you missed by selling your NFTs too early.',
  openGraph: {
    title: 'Jeeter | NFT Paperhands Checker',
    description: 'How much ETH did you miss by selling too early?',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="site-shell">{children}</div>
      </body>
    </html>
  );
}
