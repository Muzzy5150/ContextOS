import type { Metadata } from "next";
import "./vintage.css";
export const metadata: Metadata = { title: "ContextOS // Agent Runtime", description: "An inspectable runtime for long-running agents" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
