export interface AuthUser {
  token: string;
  role: "admin" | "trainer";
  username: string;
  full_name: string | null;
}

export function getAuth(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kiosk_auth");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setAuth(data: AuthUser) {
  localStorage.setItem("kiosk_auth", JSON.stringify(data));
}

export function clearAuth() {
  localStorage.removeItem("kiosk_auth");
}

export function authHeaders(): HeadersInit {
  const a = getAuth();
  return a ? { Authorization: `Bearer ${a.token}` } : {};
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    clearAuth();
    window.location.href = "/login";
  }
  return res;
}
