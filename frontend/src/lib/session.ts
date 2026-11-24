"use client";
import { useSyncExternalStore } from "react";

export interface Session { username: string; token: string }
const key = "networkai.session.v1";
let cachedValue: string | null = null;
let cachedSession: Session | null = null;
const listeners = new Set<() => void>();

export function currentSession(): Session | null {
  if (typeof window === "undefined") return null;
  let value = cachedValue;
  try { value = sessionStorage.getItem(key); } catch { /* Memory works when storage is restricted. */ }
  if (value !== cachedValue) {
    cachedValue = value;
    try {
      const result = value ? JSON.parse(value) : null;
      cachedSession = typeof result?.username === "string" && typeof result?.token === "string" ? result : null;
    } catch { cachedSession = null; }
  }
  return cachedSession;
}

export function saveSession(session: Session | null) {
  cachedSession = session;
  cachedValue = session ? JSON.stringify(session) : null;
  try {
    if (cachedValue) sessionStorage.setItem(key, cachedValue);
    else sessionStorage.removeItem(key);
  } catch { /* The API still verifies the token on every protected request. */ }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSession() { return useSyncExternalStore(subscribe, currentSession, () => null); }
