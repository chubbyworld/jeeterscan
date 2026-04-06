/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: '**.ipfs.dweb.link' },
            { protocol: 'https', hostname: 'ipfs.io' },
            { protocol: 'https', hostname: '**.nftcdn.io' },
            { protocol: 'https', hostname: 'i.seadn.io' },
            { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
            { protocol: 'https', hostname: '**.arweave.net' },
            { protocol: 'https', hostname: 'metadata.ens.domains' },
        ],
    },
    experimental: {
        serverComponentsExternalPackages: ['@prisma/client'],
    },
};

export default nextConfig;
