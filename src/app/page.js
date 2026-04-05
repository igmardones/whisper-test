import { Toaster } from "@/components/ui/sonner";
import DictationClient from "./dictation-client";

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <DictationClient />
      <Toaster richColors position="top-center" />
    </main>
  );
}
