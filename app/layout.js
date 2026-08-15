import "./globals.css";

export const metadata = {
  title: "Alugue Fácil",
  description: "Gestão de aluguéis e imóveis",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png"
  },
  appleWebApp: {
    capable: true,
    title: "Alugue Fácil",
    statusBarStyle: "default"
  }
};

export const viewport = {
  themeColor: "#0f2d52"
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
