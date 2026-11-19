import { Macondo_Swash_Caps } from "next/font/google";
import "./globals.css";

// The app's typeface: self-hosted by next/font (no request to Google at runtime).
const display = Macondo_Swash_Caps({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

export const metadata = {
  title: "Lanterns & Keys · The Old Ground",
  description: "A moonlit treasure hunt for up to four phones: point your phone like a torch to find the hidden keys.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={display.variable}>
      <body className={display.className}>{children}</body>
    </html>
  );
}
