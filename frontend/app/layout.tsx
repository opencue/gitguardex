import type { Metadata, Viewport } from 'next'
import './globals.css'

// Canonical site origin. Override per-deployment with NEXT_PUBLIC_SITE_URL
// (e.g. the production domain). Falls back to the project home so OpenGraph
// and canonical URLs always resolve to a real, reachable page.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://github.com/recodeee/gitguardex'
const OG_IMAGE = 'https://raw.githubusercontent.com/recodeee/gitguardex/main/logo.png'

const TITLE = 'GitGuardex — Guardian T-Rex for Multi-Agent Repos'
const DESCRIPTION =
  'GitGuardex gives parallel Codex, Claude, and human teammates isolated git worktrees, file locks, and PR-only merges so concurrent AI agents never overwrite each other’s work.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s | GitGuardex'
  },
  description: DESCRIPTION,
  applicationName: 'GitGuardex',
  authors: [{ name: 'recodee', url: 'https://github.com/recodeee' }],
  creator: 'recodee',
  publisher: 'recodee',
  category: 'developer tools',
  keywords: [
    'GitGuardex',
    'guardex',
    'multi-agent',
    'AI agents',
    'Codex',
    'Claude Code',
    'git worktree',
    'file locks',
    'branch guard',
    'agent safety',
    'pull request workflow',
    'OpenSpec',
    'developer tools',
    'CLI'
  ],
  alternates: {
    canonical: '/'
  },
  openGraph: {
    type: 'website',
    siteName: 'GitGuardex',
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'GitGuardex — guardian T-Rex for multi-agent repos'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1
    }
  }
}

export const viewport: Viewport = {
  themeColor: '#0b0e14',
  colorScheme: 'dark light'
}

// Structured data so search engines and generative engines (GEO) can model
// GitGuardex as an installable developer tool with a clear description.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'GitGuardex',
  alternateName: 'guardex',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS, Linux, Windows',
  description: DESCRIPTION,
  url: SITE_URL,
  image: OG_IMAGE,
  license: 'https://opensource.org/licenses/MIT',
  softwareHelp: 'https://github.com/recodeee/gitguardex#readme',
  installUrl: 'https://www.npmjs.com/package/@imdeadpool/guardex',
  downloadUrl: 'https://www.npmjs.com/package/@imdeadpool/guardex',
  author: {
    '@type': 'Organization',
    name: 'recodee',
    url: 'https://github.com/recodeee'
  },
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD'
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          // biome-ignore lint: structured-data JSON-LD injection is intentional
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  )
}
