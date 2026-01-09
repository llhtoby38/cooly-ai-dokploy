import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./contexts/AuthContext";
import { Suspense } from "react";
import { cookies } from "next/headers";
import AnalyticsProvider from "./analytics/AnalyticsProvider";
import Script from 'next/script';
 

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "COOLY.AI - AI Image Generation",
  description: "Generate beautiful images with AI",
};

async function fetchInitialUser(): Promise<any | null> {
  try {
    const cks = await cookies();
    const token = cks.get("token");
    if (!token) return null;
    const base = process.env.NEXT_PUBLIC_API_BASE;
    if (!base) return null;
    const res = await fetch(`${base}/api/user/me`, {
      cache: "no-store",
      headers: { cookie: `token=${token.value}` } as any,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialUser = await fetchInitialUser();
  // Fetch backend env flags (server-side; same origin proxy via dev rewrite)
  let mocks: any = {};
  try {
    const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000';
    const res = await fetch(`${base}/envz`, { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      mocks = j?.mocks || {};
    }
  } catch {}
  return (
    <html lang="en" suppressHydrationWarning>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          {/* Meta Pixel Code */}
          <Script
            id="meta-pixel"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '803498105939967');
                fbq('track', 'PageView');
              `,
            }}
          />
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              src="https://www.facebook.com/tr?id=803498105939967&ev=PageView&noscript=1"
            />
          </noscript>

          <AuthProvider initialUser={initialUser}>
          <Suspense fallback={null}>
            <AnalyticsProvider>
              {children}
            </AnalyticsProvider>
          </Suspense>
          {/* Top-right mock status text */}
          {(mocks && (mocks.MOCK_API || mocks.MOCK_SEEDREAM3 || mocks.MOCK_SEEDREAM4 || mocks.MOCK_SEEDANCE || mocks.MOCK_VIDEO || mocks.MOCK_SORA)) && (
            <div style={{position:'fixed',top:8,right:8,zIndex:50,background:'rgba(17,17,17,0.6)',color:'#fff',padding:'4px 8px',borderRadius:6,fontSize:12}}>
              {['API','SD3','SD4','SEEDANCE','VIDEO','SORA']
                .filter((k,idx)=>[
                  mocks.MOCK_API,
                  mocks.MOCK_SEEDREAM3,
                  mocks.MOCK_SEEDREAM4,
                  mocks.MOCK_SEEDANCE,
                  mocks.MOCK_VIDEO,
                  mocks.MOCK_SORA
                ][idx])
                .map((k)=>`MOCK ${k}`)
                .join(' · ')}
            </div>
          )}
        </AuthProvider>
      </body>
    </html>
  );
}
