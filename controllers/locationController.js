import asyncHandler from "express-async-handler";
import { nominatimSearch, nominatimReverse } from "../utils/nominatim.js";

// ──────────────────────────────────────────────────────────────
// Helpers — normalize Nominatim's shape into something stable
// ──────────────────────────────────────────────────────────────

const pickCity = (address = {}) =>
  address.city ||
  address.town ||
  address.village ||
  address.hamlet ||
  address.suburb ||
  address.county ||
  "";

const pickState = (address = {}) => address.state || address.region || "";

const pickCountry = (address = {}) => address.country || "";

const pickCountryCode = (address = {}) =>
  (address.country_code || "").toUpperCase();

const formatSearchResult = (item) => ({
  placeId: item.place_id,
  displayName: item.display_name,
  name: item.name || item.display_name?.split(",")[0] || "",
  type: item.type,
  category: item.class,
  address: {
    road: item.address?.road || "",
    neighbourhood: item.address?.neighbourhood || "",
    city: pickCity(item.address),
    state: pickState(item.address),
    postcode: item.address?.postcode || "",
    country: pickCountry(item.address),
    countryCode: pickCountryCode(item.address),
  },
  coordinates: {
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
  },
  boundingBox: item.boundingbox
    ? {
        south: parseFloat(item.boundingbox[0]),
        north: parseFloat(item.boundingbox[1]),
        west: parseFloat(item.boundingbox[2]),
        east: parseFloat(item.boundingbox[3]),
      }
    : null,
});

const formatReverseResult = (item) => ({
  placeId: item.place_id,
  displayName: item.display_name,
  name: item.name || item.display_name?.split(",")[0] || "",
  type: item.type,
  category: item.class,
  address: {
    road: item.address?.road || "",
    neighbourhood: item.address?.neighbourhood || "",
    city: pickCity(item.address),
    state: pickState(item.address),
    postcode: item.address?.postcode || "",
    country: pickCountry(item.address),
    countryCode: pickCountryCode(item.address),
  },
  coordinates: {
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
  },
});

// ──────────────────────────────────────────────────────────────
// @desc    Forward geocode — turn a text query into locations
// @route   GET /api/v1/location/search?q=&limit=
// @access  Public
// ──────────────────────────────────────────────────────────────
const searchLocation = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));

  if (!q || !q.trim()) {
    res.status(400);
    throw new Error("Query parameter `q` is required");
  }

  let results;
  try {
    results = await nominatimSearch({ q: q.trim(), limit });
  } catch (err) {
    console.error("[locationController] search failed:", err.message);
    res.status(502);
    throw new Error("Location service is unavailable, please try again");
  }

  res.status(200).json({
    success: true,
    data: results.map(formatSearchResult),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Reverse geocode — turn coordinates into an address
// @route   GET /api/v1/location/reverse?lat=&lon=
// @access  Public
// ──────────────────────────────────────────────────────────────
const reverseGeocode = asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    res.status(400);
    throw new Error("Valid `lat` and `lon` are required");
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400);
    throw new Error("Coordinates out of range");
  }

  let result;
  try {
    result = await nominatimReverse({ lat, lon });
  } catch (err) {
    console.error("[locationController] reverse failed:", err.message);
    res.status(502);
    throw new Error("Location service is unavailable, please try again");
  }

  if (!result || result.error) {
    res.status(404);
    throw new Error("No address found for these coordinates");
  }

  res.status(200).json({
    success: true,
    data: formatReverseResult(result),
  });
});

export { searchLocation, reverseGeocode };