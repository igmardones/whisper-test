import { Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

export const metadata = {
  title: "Dictado de Macroscopía",
  description: "Sistema de dictado por voz con transcripción inteligente para macroscopías anatomopatológicas",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark">
      <body className={`${roboto.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
