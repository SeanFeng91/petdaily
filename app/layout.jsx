import "./globals.css";

export const metadata = {
  title: "PetDaily",
  description: "智能宠物日常管理与 AI 养育教练"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
