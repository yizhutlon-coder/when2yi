import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "When2Yi",
  description: "Find a time. No accounts, one link, real API.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="logo">
            When<span>2</span>Yi
          </a>
          <nav>
            <a href="/api/docs?ui">API</a>
            <a href="/">New event</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          When2Yi — self-hosted, no accounts, no ads. The API does everything the site does.
        </footer>
      </body>
    </html>
  );
}
