"use server";

import { cookies } from "next/headers";
import { createHash } from "crypto";

// Genera un token hasheado a partir de la contraseña + un secreto
function generateToken(password) {
  const secret = process.env.OPENAI_API_KEY || "whisper-app-secret";
  return createHash("sha256").update(`${password}:${secret}`).digest("hex");
}

export async function login(formData) {
  const password = formData.get("password");

  if (!password) {
    return { error: "Ingresá la contraseña." };
  }

  const correctPassword = process.env.APP_PASSWORD;

  if (!correctPassword) {
    return {
      error: "No se configuró APP_PASSWORD en el servidor. Contactá al administrador.",
    };
  }

  if (password !== correctPassword) {
    return { error: "Contraseña incorrecta." };
  }

  // Crear cookie de sesión (dura 7 días)
  const token = generateToken(password);
  const cookieStore = await cookies();
  cookieStore.set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 días
    path: "/",
  });

  return { success: true };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete("auth-token");
  return { success: true };
}

export async function checkAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;

  if (!token) {
    return false;
  }

  const correctPassword = process.env.APP_PASSWORD;
  if (!correctPassword) {
    return false;
  }

  const expectedToken = generateToken(correctPassword);
  return token === expectedToken;
}
