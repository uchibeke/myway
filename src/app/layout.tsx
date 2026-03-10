import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { Suspense } from 'react'
import { ViewModeProvider } from '@/lib/view-mode'
import BrandProvider from '@/components/BrandProvider'
import PartnerAuthProvider from '@/components/PartnerAuthProvider'
import SessionRefresh from '@/components/SessionRefresh'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import InstallPrompt from '@/components/InstallPrompt'
import { getBrandConfig } from '@/lib/brand'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export function generateMetadata(): Metadata {
  const brand = getBrandConfig()
  return {
    title: brand.name,
    description: 'Your personal AI home screen',
    manifest: '/manifest.json',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: brand.name,
    },
  }
}

export function generateViewport(): Viewport {
  const brand = getBrandConfig()
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: brand.themeColor,
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = getBrandConfig()

  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={`${geist.variable} font-sans text-white antialiased`}>
        <BrandProvider defaults={brand}>
          <Suspense>
            <PartnerAuthProvider>
              <ViewModeProvider>
                {children}
              </ViewModeProvider>
              <SessionRefresh />
              <ServiceWorkerRegistration />
              <InstallPrompt />
            </PartnerAuthProvider>
          </Suspense>
        </BrandProvider>
      </body>
    </html>
  )
}
