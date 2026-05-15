import "./globals.css";

export const metadata = {
  title: "PetDaily",
  description: "智能宠物日常管理与 AI 养育教练",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PetDaily",
    statusBarStyle: "default"
  },
  icons: {
    icon: "/icons/petdaily-icon.svg",
    apple: "/icons/petdaily-icon-192.png"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#18231f"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
