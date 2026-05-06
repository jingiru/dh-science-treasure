import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'dh-science-treasure',
  description: '대전동화중 국립중앙과학관 보물찾기'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
