import "./globals.css";

export const metadata = {
  title: "The Old Ground",
  description: "A vintage 3D grass field with old stone roads, built with Next.js and three.js",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
