import { Toaster } from "@/components/ui/sonner";
import DictationClient from "./dictation-client";
import LoginClient from "./login-client";
import { checkAuth } from "./auth-actions";

export default async function Home() {
  const isAuthenticated = await checkAuth();

  return (
    <main className="min-h-screen bg-background">
      {isAuthenticated ? <DictationClient /> : <LoginClient />}
      <Toaster richColors position="top-center" />
    </main>
  );
}
