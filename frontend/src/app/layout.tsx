import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "NetworkAI — Create. Share. Discover.", description: "A place for creative ideas, community posts, and fresh perspectives." };
export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body>{children}</body></html>;
}
