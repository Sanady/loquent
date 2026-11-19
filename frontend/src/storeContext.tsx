import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import { api } from "./api/client";
import type { AppState, AppStore } from "./state/store";

type FileUrl = (id: string) => Promise<{ url: string }>;

interface Ctx {
  store: AppStore;
  fileUrl: FileUrl;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ store, fileUrl, children }: { store: AppStore; fileUrl?: FileUrl; children: ReactNode }) {
  return <StoreContext.Provider value={{ store, fileUrl: fileUrl ?? api.fileUrl }}>{children}</StoreContext.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(StoreContext);
  if (!c) throw new Error("StoreProvider missing");
  return c;
}

export function useAppStore(): AppStore {
  return useCtx().store;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useCtx().store, selector);
}

export function useFileUrl(): FileUrl {
  return useCtx().fileUrl;
}
