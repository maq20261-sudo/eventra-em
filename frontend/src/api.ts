import { storage } from "@/src/utils/storage";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const TOKEN_KEY = "gs_auth_token";

export async function getToken(): Promise<string | null> {
  return await storage.secureGet(TOKEN_KEY, null);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) {
    await storage.secureSet(TOKEN_KEY, token);
  } else {
    await storage.secureRemove(TOKEN_KEY);
  }
}

async function request(
  path: string,
  options: RequestInit = {},
  requireAuth: boolean = false
): Promise<any> {
  const token = requireAuth ? await getToken() : await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

export const api = {
  // Auth
  register: (body: { email: string; password: string; name: string; role: "consumer" | "organizer" }) =>
    request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => request("/auth/me", { method: "GET" }, true),

  // Events
  listEvents: (params: {
    lat?: number;
    lng?: number;
    radius_km?: number;
    category?: string;
    search?: string;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
    });
    return request(`/events?${q.toString()}`, { method: "GET" });
  },
  getEvent: (id: string) => request(`/events/${id}`, { method: "GET" }),
  createEvent: (body: any) =>
    request("/events", { method: "POST", body: JSON.stringify(body) }, true),
  updateEvent: (id: string, body: any) =>
    request(`/events/${id}`, { method: "PUT", body: JSON.stringify(body) }, true),
  deleteEvent: (id: string) =>
    request(`/events/${id}`, { method: "DELETE" }, true),
  bookedSeats: (id: string) => request(`/events/${id}/booked-seats`, { method: "GET" }),
  myOrgEvents: () => request(`/organizer/events`, { method: "GET" }, true),

  // Bookings
  createBooking: (body: any) =>
    request("/bookings", { method: "POST", body: JSON.stringify(body) }, true),
  myBookings: () => request("/bookings/me", { method: "GET" }, true),
  cancelBooking: (id: string) =>
    request(`/bookings/${id}/cancel`, { method: "POST" }, true),

  // Analytics
  organizerAnalytics: () => request("/analytics/organizer", { method: "GET" }, true),
};

export type UserRole = "consumer" | "organizer";
export type User = { id: string; email: string; name: string; role: UserRole };
