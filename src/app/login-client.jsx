"use client";

import { useState } from "react";
import { login } from "./auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Lock, Loader2 } from "lucide-react";

export default function LoginClient() {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const formData = new FormData(e.target);
      const result = await login(formData);

      if (result.error) {
        setError(result.error);
      } else if (result.success) {
        window.location.reload();
      }
    } catch {
      setError("Error al iniciar sesión. Intentá de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 shadow-lg shadow-primary/10">
            <Mic className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Dictado de Macroscopía</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sistema de transcripción médica</p>
          </div>
        </div>

        {/* Login Card */}
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Contraseña de acceso
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    name="password"
                    type="password"
                    placeholder="Ingresá la contraseña"
                    autoFocus
                    required
                    disabled={isLoading}
                    className="h-11 pl-10 bg-background/50 border-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full h-11 font-medium" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  "Ingresar"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
