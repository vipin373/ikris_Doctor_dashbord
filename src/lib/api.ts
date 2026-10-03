import { supabase } from "./supabase";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function token(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Query = {}): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const body = await res.json();
      message = typeof body.detail === "string" ? body.detail : message;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ikris:unauthorized"));
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

export const api = {
  get: async <T>(path: string, params?: Query): Promise<T> => (await request(path + qs(params))).json(),
  post: async <T>(path: string, body?: unknown): Promise<T> =>
    (await request(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) })).json(),
  put: async <T>(path: string, body: unknown): Promise<T> =>
    (await request(path, { method: "PUT", body: JSON.stringify(body) })).json(),
  del: async <T>(path: string): Promise<T> => (await request(path, { method: "DELETE" })).json(),
  download: async (path: string, params: Query, filename: string): Promise<void> => {
    const res = await request(path + qs(params));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
