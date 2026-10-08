// utils/nominatim.js
const BASE_URL = "https://nominatim.openstreetmap.org";

// Nominatim requires an identifying User-Agent + contact email.
// See: https://operations.osmfoundation.org/policies/nominatim/
const HEADERS = {
  "User-Agent": process.env.NOMINATIM_USER_AGENT || "BusinessDiscoveryApp/1.0",
  Accept: "application/json",
  ...(process.env.NOMINATIM_EMAIL
    ? { "From": process.env.NOMINATIM_EMAIL }
    : {}),
};

// Simple in-memory cache so we don't hammer Nominatim during dev / bursts
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

const cacheGet = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};

const cacheSet = (key, value) => {
  cache.set(key, { at: Date.now(), value });
};

// Basic fetch with timeout (Node 18+ has global fetch)
const fetchJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`Nominatim responded ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
};

export const nominatimSearch = async ({ q, limit = 5 }) => {
  const key = `search:${q}:${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${BASE_URL}/search?q=${encodeURIComponent(
    q
  )}&format=jsonv2&addressdetails=1&limit=${limit}`;

  const data = await fetchJson(url);
  cacheSet(key, data);
  return data;
};

export const nominatimReverse = async ({ lat, lon }) => {
  const key = `reverse:${lat}:${lon}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${BASE_URL}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1`;

  const data = await fetchJson(url);
  cacheSet(key, data);
  return data;
};