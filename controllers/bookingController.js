// src/controllers/bookingController.js
import crypto from "crypto";
import asyncHandler from "express-async-handler";
import Booking from "../models/bookingModel.js";
import User from "../models/userModel.js";
import { logActivity } from "../utils/logActivity.js";
import {
  sendBookingReceived,
  sendBookingRequestSubmitted,
  sendBookingConfirmed,
  sendBookingRejected,
  sendBookingCancelled,
} from "../utils/resendMail.js";

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────
const BOOKING_KINDS = ["hotels", "dining", "things_to_do", "shops", "others"];
const MAX_ROOMS = 20;
const MAX_GUESTS = 50;
const MAX_LEAD_DAYS = 730; // ~2 years
const CANCEL_CUTOFF_HOURS = 24;

const BUSINESS_PUBLIC_FIELDS =
  "businessName businessKind businessKindOther logo coverImage location " +
  "priceRange phone email categorySlug";

// ──────────────────────────────────────────────────────────────
// Small utils
// ──────────────────────────────────────────────────────────────
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const startOfToday = () => startOfDay(new Date());

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const combineDateTime = (dateVal, timeVal) => {
  const d = toDate(dateVal);
  if (!d) return null;
  if (isNonEmptyString(timeVal) && /^\d{1,2}:\d{2}$/.test(timeVal.trim())) {
    const [h, m] = timeVal.trim().split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) d.setHours(h, m, 0, 0);
  }
  return d;
};

const parsePagination = (query, defaultLimit = 20, maxLimit = 50) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(query.limit, 10) || defaultLimit)
  );
  return { page, limit, skip: (page - 1) * limit };
};

const fireMail = (promise) => {
  Promise.resolve(promise).catch((err) =>
    console.error("[mail]", err?.message || err)
  );
};

const generateReferenceCode = (kind) => {
  const prefix =
    {
      hotels: "HTL",
      dining: "DIN",
      things_to_do: "TTD",
      shops: "SHP",
      others: "GEN",
    }[kind] || "BKG";
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  return `BK-${prefix}-${stamp}-${rand}`;
};

// ──────────────────────────────────────────────────────────────
// FORM SCHEMA — tells the client which fields to render per kind
// ──────────────────────────────────────────────────────────────
const BOOKING_FORM_SCHEMA = {
  hotels: {
    label: "Hotel / Lodge reservation",
    summary: "checkIn → checkOut · {nights} night(s) · {rooms} room(s)",
    fields: [
      { name: "checkIn", label: "Check-in date", type: "date", required: true },
      { name: "checkOut", label: "Check-out date", type: "date", required: true },
      { name: "rooms", label: "Rooms", type: "number", required: true, min: 1, max: MAX_ROOMS, default: 1 },
      { name: "adults", label: "Adults", type: "number", required: true, min: 1, max: MAX_GUESTS, default: 2 },
      { name: "children", label: "Children", type: "number", required: false, min: 0, max: MAX_GUESTS, default: 0 },
      { name: "roomType", label: "Room type", type: "text", required: false, placeholder: "Deluxe, Suite…" },
    ],
  },
  dining: {
    label: "Table reservation",
    summary: "{partySize} guest(s) on {reservationDate} at {reservationTime}",
    fields: [
      { name: "reservationDate", label: "Date", type: "date", required: true },
      { name: "reservationTime", label: "Time", type: "time", required: true, placeholder: "19:30" },
      { name: "partySize", label: "Party size", type: "number", required: true, min: 1, max: MAX_GUESTS, default: 2 },
      { name: "occasion", label: "Occasion", type: "text", required: false, placeholder: "Birthday, Anniversary…" },
      {
        name: "seatingPreference",
        label: "Seating",
        type: "select",
        required: false,
        options: ["no_preference", "indoor", "outdoor", "bar", "private_room"],
        default: "no_preference",
      },
    ],
  },
  things_to_do: {
    label: "Activity booking",
    summary: "{participants} participant(s) on {activityDate}",
    fields: [
      { name: "activityDate", label: "Date", type: "date", required: true },
      { name: "timeSlot", label: "Time slot", type: "text", required: false, placeholder: "09:00 - 11:00" },
      { name: "participants", label: "Participants", type: "number", required: true, min: 1, max: MAX_GUESTS, default: 1 },
      {
        name: "ageGroup",
        label: "Age group",
        type: "select",
        required: false,
        options: ["any", "kids", "teens", "adults", "seniors"],
        default: "any",
      },
      { name: "pickupLocation", label: "Pickup location", type: "text", required: false },
    ],
  },
  shops: {
    label: "Order / appointment",
    summary: "{fulfillmentType} on {preferredDate}",
    fields: [
      {
        name: "fulfillmentType",
        label: "How would you like it?",
        type: "select",
        required: true,
        options: ["pickup", "delivery", "appointment"],
        default: "pickup",
      },
      { name: "preferredDate", label: "Preferred date", type: "date", required: true },
      { name: "preferredTime", label: "Preferred time", type: "time", required: false },
      { name: "deliveryAddress", label: "Delivery address", type: "text", required: false, dependsOn: { field: "fulfillmentType", value: "delivery" } },
      {
        name: "items",
        label: "Items",
        type: "repeater",
        required: false,
        itemFields: [
          { name: "name", type: "text", required: true },
          { name: "quantity", type: "number", required: true, min: 1, default: 1 },
        ],
      },
    ],
  },
  others: {
    label: "Booking request",
    summary: "{preferredDate}",
    fields: [
      { name: "preferredDate", label: "Preferred date", type: "date", required: true },
      { name: "preferredTime", label: "Preferred time", type: "time", required: false },
      { name: "purpose", label: "What is this for?", type: "text", required: false },
    ],
  },
};

// ──────────────────────────────────────────────────────────────
// DETAILS VALIDATORS (one per kind)
// ──────────────────────────────────────────────────────────────

const validateHotelDetails = (raw = {}) => {
  const errors = [];
  const checkIn = toDate(raw.checkIn);
  const checkOut = toDate(raw.checkOut);
  const today = startOfToday();

  if (!checkIn) errors.push("checkIn is required and must be a valid date");
  if (!checkOut) errors.push("checkOut is required and must be a valid date");

  if (checkIn && startOfDay(checkIn) < today) {
    errors.push("checkIn cannot be in the past");
  }
  if (checkIn && checkOut && checkOut <= checkIn) {
    errors.push("checkOut must be after checkIn");
  }

  const maxDate = addDays(today, MAX_LEAD_DAYS);
  if (checkIn && checkIn > maxDate) {
    errors.push(`checkIn cannot be more than ${MAX_LEAD_DAYS} days ahead`);
  }

  const rooms = toInt(raw.rooms);
  if (!Number.isFinite(rooms) || rooms < 1 || rooms > MAX_ROOMS) {
    errors.push(`rooms must be an integer between 1 and ${MAX_ROOMS}`);
  }

  const adults = toInt(raw.adults);
  if (!Number.isFinite(adults) || adults < 1 || adults > MAX_GUESTS) {
    errors.push(`adults must be an integer between 1 and ${MAX_GUESTS}`);
  }

  const children = raw.children === undefined || raw.children === "" ? 0 : toInt(raw.children);
  if (!Number.isFinite(children) || children < 0 || children > MAX_GUESTS) {
    errors.push(`children must be an integer between 0 and ${MAX_GUESTS}`);
  }

  const nights =
    checkIn && checkOut && checkOut > checkIn
      ? Math.ceil((checkOut - checkIn) / 86_400_000)
      : null;

  return {
    errors,
    value: {
      checkIn,
      checkOut,
      nights,
      rooms,
      adults,
      children,
      roomType: isNonEmptyString(raw.roomType)
        ? String(raw.roomType).trim().slice(0, 80)
        : undefined,
    },
    startAt: checkIn,
    endAt: checkOut,
  };
};

const validateDiningDetails = (raw = {}) => {
  const errors = [];
  const reservationDate = toDate(raw.reservationDate);
  const today = startOfToday();

  if (!reservationDate) {
    errors.push("reservationDate is required and must be a valid date");
  } else if (startOfDay(reservationDate) < today) {
    errors.push("reservationDate cannot be in the past");
  }

  const timeStr = isNonEmptyString(raw.reservationTime)
    ? String(raw.reservationTime).trim()
    : "";
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) {
    errors.push("reservationTime is required and must be in HH:MM format");
  }

  const startAt = combineDateTime(reservationDate, timeStr);
  if (startAt && startAt <= new Date()) {
    errors.push("reservation must be in the future");
  }

  const partySize = toInt(raw.partySize);
  if (!Number.isFinite(partySize) || partySize < 1 || partySize > MAX_GUESTS) {
    errors.push(`partySize must be an integer between 1 and ${MAX_GUESTS}`);
  }

  const SEATING = ["no_preference", "indoor", "outdoor", "bar", "private_room"];
  const seatingPreference = isNonEmptyString(raw.seatingPreference)
    ? String(raw.seatingPreference).trim()
    : "no_preference";
  if (!SEATING.includes(seatingPreference)) {
    errors.push(`seatingPreference must be one of: ${SEATING.join(", ")}`);
  }

  return {
    errors,
    value: {
      reservationDate,
      reservationTime: timeStr,
      partySize,
      occasion: isNonEmptyString(raw.occasion)
        ? String(raw.occasion).trim().slice(0, 120)
        : undefined,
      seatingPreference,
    },
    startAt,
    endAt: startAt ? new Date(startAt.getTime() + 2 * 3600_000) : null,
  };
};

const validateThingsToDoDetails = (raw = {}) => {
  const errors = [];
  const activityDate = toDate(raw.activityDate);
  const today = startOfToday();

  if (!activityDate) {
    errors.push("activityDate is required and must be a valid date");
  } else if (startOfDay(activityDate) < today) {
    errors.push("activityDate cannot be in the past");
  }

  const participants = toInt(raw.participants);
  if (!Number.isFinite(participants) || participants < 1 || participants > MAX_GUESTS) {
    errors.push(`participants must be an integer between 1 and ${MAX_GUESTS}`);
  }

  const AGE_GROUPS = ["any", "kids", "teens", "adults", "seniors"];
  const ageGroup = isNonEmptyString(raw.ageGroup)
    ? String(raw.ageGroup).trim()
    : "any";
  if (!AGE_GROUPS.includes(ageGroup)) {
    errors.push(`ageGroup must be one of: ${AGE_GROUPS.join(", ")}`);
  }

  const timeSlot = isNonEmptyString(raw.timeSlot)
    ? String(raw.timeSlot).trim().slice(0, 60)
    : undefined;

  let startAt = activityDate ? startOfDay(activityDate) : null;
  if (startAt && timeSlot && /^\d{1,2}:\d{2}/.test(timeSlot)) {
    startAt = combineDateTime(startAt, timeSlot.slice(0, 5));
  }
  if (startAt && startAt <= new Date()) {
    errors.push("activity must be in the future");
  }

  return {
    errors,
    value: {
      activityDate,
      timeSlot,
      participants,
      ageGroup,
      pickupLocation: isNonEmptyString(raw.pickupLocation)
        ? String(raw.pickupLocation).trim().slice(0, 200)
        : undefined,
    },
    startAt,
    endAt: null,
  };
};

const validateShopDetails = (raw = {}) => {
  const errors = [];
  const FULFILLMENT = ["pickup", "delivery", "appointment"];

  const fulfillmentType = isNonEmptyString(raw.fulfillmentType)
    ? String(raw.fulfillmentType).trim()
    : "";
  if (!FULFILLMENT.includes(fulfillmentType)) {
    errors.push(`fulfillmentType must be one of: ${FULFILLMENT.join(", ")}`);
  }

  const preferredDate = toDate(raw.preferredDate);
  if (!preferredDate) {
    errors.push("preferredDate is required and must be a valid date");
  } else if (startOfDay(preferredDate) < startOfToday()) {
    errors.push("preferredDate cannot be in the past");
  }

  const preferredTime = isNonEmptyString(raw.preferredTime)
    ? String(raw.preferredTime).trim()
    : undefined;
  if (preferredTime && !/^\d{1,2}:\d{2}$/.test(preferredTime)) {
    errors.push("preferredTime must be in HH:MM format");
  }

  const deliveryAddress = isNonEmptyString(raw.deliveryAddress)
    ? String(raw.deliveryAddress).trim().slice(0, 300)
    : undefined;
  if (fulfillmentType === "delivery" && !deliveryAddress) {
    errors.push("deliveryAddress is required when fulfillmentType is delivery");
  }

  let items;
  if (raw.items !== undefined) {
    const parsed = Array.isArray(raw.items) ? raw.items : [];
    if (!Array.isArray(raw.items)) {
      errors.push("items must be an array");
    } else if (parsed.length > 50) {
      errors.push("items cannot exceed 50 entries");
    } else {
      items = [];
      parsed.forEach((it, i) => {
        const name = it?.name ? String(it.name).trim() : "";
        const quantity = toInt(it?.quantity);
        if (!name) errors.push(`items[${i}].name is required`);
        if (!Number.isFinite(quantity) || quantity < 1) {
          errors.push(`items[${i}].quantity must be an integer >= 1`);
        }
        if (name && Number.isFinite(quantity) && quantity >= 1) {
          items.push({ name: name.slice(0, 120), quantity });
        }
      });
    }
  }

  const startAt = combineDateTime(preferredDate, preferredTime);

  return {
    errors,
    value: {
      fulfillmentType,
      preferredDate,
      preferredTime,
      deliveryAddress,
      items,
    },
    startAt,
    endAt: null,
  };
};

const validateGenericDetails = (raw = {}) => {
  const errors = [];
  const preferredDate = toDate(raw.preferredDate);

  if (!preferredDate) {
    errors.push("preferredDate is required and must be a valid date");
  } else if (startOfDay(preferredDate) < startOfToday()) {
    errors.push("preferredDate cannot be in the past");
  }

  const preferredTime = isNonEmptyString(raw.preferredTime)
    ? String(raw.preferredTime).trim()
    : undefined;
  if (preferredTime && !/^\d{1,2}:\d{2}$/.test(preferredTime)) {
    errors.push("preferredTime must be in HH:MM format");
  }

  const startAt = combineDateTime(preferredDate, preferredTime);
  if (startAt && startAt <= new Date()) {
    errors.push("preferred date/time must be in the future");
  }

  return {
    errors,
    value: {
      preferredDate,
      preferredTime,
      purpose: isNonEmptyString(raw.purpose)
        ? String(raw.purpose).trim().slice(0, 200)
        : undefined,
    },
    startAt,
    endAt: null,
  };
};

const DETAILS_VALIDATORS = {
  hotels: validateHotelDetails,
  dining: validateDiningDetails,
  things_to_do: validateThingsToDoDetails,
  shops: validateShopDetails,
  others: validateGenericDetails,
};

// ──────────────────────────────────────────────────────────────
// Booking summary (human readable)
// ──────────────────────────────────────────────────────────────
const buildSummary = (kind, details = {}) => {
  switch (kind) {
    case "hotels": {
      const nights = details.nights ?? "?";
      return `${nights} night(s) · ${details.rooms} room(s) · ${details.adults} adult(s)${
        details.children ? `, ${details.children} child(ren)` : ""
      }`;
    }
    case "dining":
      return `${details.partySize} guest(s) on ${new Date(
        details.reservationDate
      ).toDateString()} at ${details.reservationTime}`;
    case "things_to_do":
      return `${details.participants} participant(s) on ${new Date(
        details.activityDate
      ).toDateString()}${details.timeSlot ? ` · ${details.timeSlot}` : ""}`;
    case "shops":
      return `${details.fulfillmentType} on ${new Date(
        details.preferredDate
      ).toDateString()}`;
    default:
      return `Requested for ${new Date(details.preferredDate).toDateString()}`;
  }
};

// ──────────────────────────────────────────────────────────────
// Shared: load a bookable business
// ──────────────────────────────────────────────────────────────
const loadBookableBusiness = async (id) => {
  if (!id || !id.match?.(/^[0-9a-fA-F]{24}$/)) return null;
  return User.findOne({
    _id: id,
    role: "business",
    businessVerified: true,
    isVerified: true,
    isActive: true,
  }).select(BUSINESS_PUBLIC_FIELDS);
};

// ══════════════════════════════════════════════════════════════
// FORM SCHEMA ENDPOINT
// ══════════════════════════════════════════════════════════════

const getBookingFormSchema = asyncHandler(async (req, res) => {
  const business = await loadBookableBusiness(req.params.businessId);
  if (!business) {
    res.status(404);
    throw new Error("Business not found or not accepting bookings");
  }

  const kind = BOOKING_KINDS.includes(business.businessKind)
    ? business.businessKind
    : "others";

  res.status(200).json({
    success: true,
    data: {
      business: {
        _id: business._id,
        businessName: business.businessName,
        businessKind: kind,
        businessKindOther: business.businessKindOther || null,
        logo: business.logo || null,
        location: business.location || null,
      },
      kind,
      schema: BOOKING_FORM_SCHEMA[kind],
      constants: {
        maxRooms: MAX_ROOMS,
        maxGuests: MAX_GUESTS,
        cancelCutoffHours: CANCEL_CUTOFF_HOURS,
      },
    },
  });
});

// ══════════════════════════════════════════════════════════════
// CUSTOMER — create booking
// ══════════════════════════════════════════════════════════════

const createBooking = asyncHandler(async (req, res) => {
  const customer = await User.findById(req.user._id);
  if (!customer) {
    res.status(404);
    throw new Error("Account not found");
  }

  if (!customer.isVerified) {
    res.status(403);
    throw new Error("Verify your email before making a booking");
  }

  const business = await loadBookableBusiness(req.params.businessId);
  if (!business) {
    res.status(404);
    throw new Error("Business not found or not accepting bookings");
  }

  if (String(business._id) === String(customer._id)) {
    res.status(400);
    throw new Error("You cannot book your own business");
  }

  const kind = BOOKING_KINDS.includes(business.businessKind)
    ? business.businessKind
    : "others";

  const rawDetails = req.body.details ?? req.body;

  const validator = DETAILS_VALIDATORS[kind];
  const { errors, value, startAt, endAt } = validator(rawDetails);

  if (errors.length) {
    res.status(400);
    throw new Error(errors.join("; "));
  }

  // Prevent double-booking the same business at the same moment
  if (startAt) {
    const windowStart = new Date(startAt.getTime() - 30 * 60_000);
    const windowEnd = new Date(startAt.getTime() + 30 * 60_000);

    const clash = await Booking.findOne({
      business: business._id,
      customer: customer._id,
      status: { $in: ["pending", "confirmed"] },
      startAt: { $gte: windowStart, $lte: windowEnd },
    }).select("_id referenceCode");

    if (clash) {
      res.status(409);
      throw new Error(
        `You already have a ${
          clash.referenceCode ? `booking (${clash.referenceCode})` : "booking"
        } around this time`
      );
    }
  }

  const guestName =
    isNonEmptyString(req.body.guestName)
      ? String(req.body.guestName).trim()
      : customer.fullName || customer.name || "Guest";

  const guestEmail =
    isNonEmptyString(req.body.guestEmail)
      ? String(req.body.guestEmail).trim().toLowerCase()
      : customer.email;

  const guestPhone =
    isNonEmptyString(req.body.guestPhone)
      ? String(req.body.guestPhone).trim()
      : customer.phone || "";

  if (!guestPhone) {
    res.status(400);
    throw new Error("guestPhone is required");
  }

  let estimatedTotal;
  if (req.body.estimatedTotal !== undefined && req.body.estimatedTotal !== "") {
    const n = Number(req.body.estimatedTotal);
    if (Number.isFinite(n) && n >= 0) estimatedTotal = n;
  }

  const booking = await Booking.create({
    business: business._id,
    customer: customer._id,
    kind,
    businessName: business.businessName,
    status: "pending",
    referenceCode: generateReferenceCode(kind),
    guestName,
    guestEmail,
    guestPhone,
    specialRequests: isNonEmptyString(req.body.specialRequests)
      ? String(req.body.specialRequests).trim().slice(0, 1500)
      : undefined,
    estimatedTotal,
    currency: isNonEmptyString(req.body.currency)
      ? String(req.body.currency).trim().toUpperCase().slice(0, 8)
      : "NGN",
    details: value,
    startAt: startAt || undefined,
    endAt: endAt || undefined,
  });

  const summary = buildSummary(kind, value);

  // Business activity feed
  await logActivity({
    userId: business._id,
    action: "New booking request",
    category: "Bookings",
    detail: `${guestName} — ${summary} (Ref ${booking.referenceCode})`,
    status: "pending",
    req,
  });

  // Customer activity feed
  await logActivity({
    userId: customer._id,
    action: "Booking request sent",
    category: "Bookings",
    detail: `Request to ${business.businessName} — ${summary} (Ref ${booking.referenceCode})`,
    status: "pending",
    req,
  });

  // Notify the business
  if (!business.email) {
    console.warn(
      `[booking] business ${business._id} has no email — business notification skipped`
    );
  }
  fireMail(
    sendBookingReceived({
      to: business.email,
      businessName: business.businessName,
      guestName,
      guestEmail,
      guestPhone,
      referenceCode: booking.referenceCode,
      kind,
      summary,
      specialRequests: booking.specialRequests,
      startAt: booking.startAt,
    })
  );

  // Confirm to the customer
  fireMail(
    sendBookingRequestSubmitted({
      to: guestEmail,
      businessName: business.businessName,
      guestName,
      referenceCode: booking.referenceCode,
      kind,
      summary,
      startAt: booking.startAt,
    })
  );

  res.status(201).json({
    success: true,
    message: "Booking request sent. Awaiting confirmation.",
    data: {
      ...booking.toObject(),
      summary,
    },
  });
});

// ══════════════════════════════════════════════════════════════
// CUSTOMER — read
// ══════════════════════════════════════════════════════════════

const getMyBookings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 20, 50);

  const filter = { customer: req.user._id };

  if (req.query.status && req.query.status !== "all") {
    filter.status = req.query.status;
  }
  if (req.query.kind && req.query.kind !== "all") {
    filter.kind = req.query.kind;
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("business", "businessName logo businessKind location"),
    Booking.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: bookings,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: skip + bookings.length < total,
    },
  });
});

const getBookingById = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate("business", "businessName logo businessKind location phone email")
    .populate("customer", "fullName email phone");

  if (!booking) {
    res.status(404);
    throw new Error("Booking not found");
  }

  const customerId = String(booking.customer?._id || booking.customer);
  const businessId = String(booking.business?._id || booking.business);

  const isCustomer = customerId === String(req.user._id);
  const isBusiness = businessId === String(req.user._id);
  const isAdmin = req.user.role === "admin";

  if (!isCustomer && !isBusiness && !isAdmin) {
    res.status(403);
    throw new Error("Not authorised to view this booking");
  }

  res.status(200).json({
    success: true,
    data: {
      ...booking.toObject(),
      summary: buildSummary(booking.kind, booking.details),
      viewer: isAdmin ? "admin" : isBusiness ? "business" : "customer",
    },
  });
});

// ══════════════════════════════════════════════════════════════
// CUSTOMER — cancel
// ══════════════════════════════════════════════════════════════

const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate(
    "business",
    "businessName email"
  );

  if (!booking) {
    res.status(404);
    throw new Error("Booking not found");
  }

  if (String(booking.customer) !== String(req.user._id)) {
    res.status(403);
    throw new Error("Not authorised to cancel this booking");
  }

  if (!["pending", "confirmed"].includes(booking.status)) {
    res.status(400);
    throw new Error(`A ${booking.status} booking cannot be cancelled`);
  }

  if (
    booking.startAt &&
    booking.startAt.getTime() - Date.now() < CANCEL_CUTOFF_HOURS * 3600_000
  ) {
    res.status(400);
    throw new Error(
      `Bookings can only be cancelled at least ${CANCEL_CUTOFF_HOURS} hours in advance`
    );
  }

  booking.status = "cancelled";
  booking.cancelledAt = new Date();
  booking.cancelledBy = "customer";
  booking.cancellationReason = isNonEmptyString(req.body?.reason)
    ? String(req.body.reason).trim().slice(0, 1000)
    : undefined;

  await booking.save();

  await logActivity({
    userId: booking.customer,
    action: "Booking cancelled",
    category: "Bookings",
    detail: `Your booking with ${booking.businessName} (Ref ${booking.referenceCode}) was cancelled.`,
    status: "info",
    req,
  });

  fireMail(
    sendBookingCancelled({
      to: booking.business?.email,
      businessName: booking.businessName,
      guestName: booking.guestName,
      referenceCode: booking.referenceCode,
      cancelledBy: "customer",
      reason: booking.cancellationReason,
    })
  );

  res.status(200).json({
    success: true,
    message: "Booking cancelled",
    data: booking,
  });
});

// ══════════════════════════════════════════════════════════════
// BUSINESS — read
// ══════════════════════════════════════════════════════════════

const getBusinessBookings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 20, 50);

  const filter = { business: req.user._id };

  if (req.query.status && req.query.status !== "all") {
    filter.status = req.query.status;
  }
  if (req.query.kind && req.query.kind !== "all") {
    filter.kind = req.query.kind;
  }
  if (req.query.from || req.query.to) {
    filter.startAt = {};
    const from = toDate(req.query.from);
    const to = toDate(req.query.to);
    if (from) filter.startAt.$gte = from;
    if (to) filter.startAt.$lte = to;
    if (!Object.keys(filter.startAt).length) delete filter.startAt;
  }
  if (req.query.q) {
    const q = String(req.query.q).trim();
    filter.$or = [
      { guestName: { $regex: q, $options: "i" } },
      { guestEmail: { $regex: q, $options: "i" } },
      { referenceCode: { $regex: q, $options: "i" } },
    ];
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("customer", "fullName email phone avatar"),
    Booking.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: bookings.map((b) => ({
      ...b.toObject(),
      summary: buildSummary(b.kind, b.details),
    })),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: skip + bookings.length < total,
    },
  });
});

const getBusinessBookingStats = asyncHandler(async (req, res) => {
  const businessId = req.user._id;

  const [byStatus, byKind, upcoming] = await Promise.all([
    Booking.aggregate([
      { $match: { business: businessId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { business: businessId } },
      { $group: { _id: "$kind", count: { $sum: 1 } } },
    ]),
    Booking.countDocuments({
      business: businessId,
      status: "confirmed",
      startAt: { $gte: new Date() },
    }),
  ]);

  const statusMap = byStatus.reduce((acc, r) => {
    acc[r._id] = r.count;
    return acc;
  }, {});

  const kindMap = byKind.reduce((acc, r) => {
    acc[r._id] = r.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      total: Object.values(statusMap).reduce((a, b) => a + b, 0),
      byStatus: statusMap,
      byKind: kindMap,
      upcomingConfirmed: upcoming,
    },
  });
});

// ══════════════════════════════════════════════════════════════
// BUSINESS — state transitions
// ══════════════════════════════════════════════════════════════

const assertBusinessOwnsBooking = (booking, req) => {
  if (
    String(booking.business?._id || booking.business) !== String(req.user._id)
  ) {
    const err = new Error("Not authorised to manage this booking");
    err.status = 403;
    throw err;
  }
};

const confirmBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate(
    "business",
    "businessName email"
  );

  if (!booking) {
    res.status(404);
    throw new Error("Booking not found");
  }
  assertBusinessOwnsBooking(booking, req);

  if (booking.status !== "pending") {
    res.status(400);
    throw new Error("Only pending bookings can be confirmed");
  }

  booking.status = "confirmed";
  booking.confirmedAt = new Date();
  booking.respondedAt = new Date();
  if (isNonEmptyString(req.body?.businessNotes)) {
    booking.businessNotes = String(req.body.businessNotes).trim().slice(0, 1000);
  }
  if (req.body?.estimatedTotal !== undefined && req.body.estimatedTotal !== "") {
    const n = Number(req.body.estimatedTotal);
    if (Number.isFinite(n) && n >= 0) booking.estimatedTotal = n;
  }

  await booking.save();

  const summary = buildSummary(booking.kind, booking.details);

  await logActivity({
    userId: booking.customer,
    action: "Booking confirmed",
    category: "Bookings",
    detail: `${booking.businessName} confirmed your booking (Ref ${booking.referenceCode}) — ${summary}`,
    status: "success",
    req,
  });

  fireMail(
    sendBookingConfirmed({
      to: booking.guestEmail,
      businessName: booking.businessName,
      guestName: booking.guestName,
      referenceCode: booking.referenceCode,
      kind: booking.kind,
      summary,
      startAt: booking.startAt,
      businessNotes: booking.businessNotes,
    })
  );

  res.status(200).json({
    success: true,
    message: "Booking confirmed",
    data: { ...booking.toObject(), summary },
  });
});

const rejectBooking = asyncHandler(async (req, res) => {
  const reason = isNonEmptyString(req.body?.reason)
    ? String(req.body.reason).trim().slice(0, 1000)
    : "";

  if (!reason) {
    res.status(400);
    throw new Error("Rejection reason is required");
  }

  const booking = await Booking.findById(req.params.id).populate(
    "business",
    "businessName email"
  );

  if (!booking) {
    res.status(404);
    throw new Error("Booking not found");
  }
  assertBusinessOwnsBooking(booking, req);

  if (booking.status !== "pending") {
    res.status(400);
    throw new Error("Only pending bookings can be rejected");
  }

  booking.status = "rejected";
  booking.rejectedAt = new Date();
  booking.respondedAt = new Date();
  booking.rejectionReason = reason;

  await booking.save();

  await logActivity({
    userId: booking.customer,
    action: "Booking rejected",
    category: "Bookings",
    detail: `${booking.businessName} declined your booking (Ref ${booking.referenceCode}). Reason: ${reason}`,
    status: "error",
    req,
  });

  fireMail(
    sendBookingRejected({
      to: booking.guestEmail,
      businessName: booking.businessName,
      guestName: booking.guestName,
      referenceCode: booking.referenceCode,
      reason,
    })
  );

  res.status(200).json({
    success: true,
    message: "Booking rejected",
    data: booking,
  });
});

const completeBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate(
    "business",
    "businessName email"
  );

  if (!booking) {
    res.status(404);
    throw new Error("Booking not found");
  }
  assertBusinessOwnsBooking(booking, req);

  if (booking.status !== "confirmed") {
    res.status(400);
    throw new Error("Only confirmed bookings can be marked as completed");
  }

  booking.status = "completed";
  booking.completedAt = new Date();

  await booking.save();

  await logActivity({
    userId: booking.customer,
    action: "Booking completed",
    category: "Bookings",
    detail: `Your booking with ${booking.businessName} (Ref ${booking.referenceCode}) is complete.`,
    status: "success",
    req,
  });

  res.status(200).json({
    success: true,
    message: "Booking marked as completed",
    data: booking,
  });
});

const markBookingNoShow = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate(
    "business",
    "businessName email"
  );

  if (!booking) {
    res.status(404);
    throw new Error("Booking not found");
  }
  assertBusinessOwnsBooking(booking, req);

  if (booking.status !== "confirmed") {
    res.status(400);
    throw new Error("Only confirmed bookings can be marked as no-show");
  }

  booking.status = "no_show";
  booking.respondedAt = new Date();
  if (isNonEmptyString(req.body?.note)) {
    booking.businessNotes = String(req.body.note).trim().slice(0, 1000);
  }

  await booking.save();

  await logActivity({
    userId: booking.customer,
    action: "Booking marked as no-show",
    category: "Bookings",
    detail: `${booking.businessName} marked your booking (Ref ${booking.referenceCode}) as a no-show.`,
    status: "error",
    req,
  });

  res.status(200).json({
    success: true,
    message: "Booking marked as no-show",
    data: booking,
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════

const listAllBookings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 20, 100);

  const filter = {};
  if (req.query.status && req.query.status !== "all")
    filter.status = req.query.status;
  if (req.query.kind && req.query.kind !== "all") filter.kind = req.query.kind;
  if (req.query.business) filter.business = req.query.business;
  if (req.query.customer) filter.customer = req.query.customer;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    filter.$or = [
      { referenceCode: { $regex: q, $options: "i" } },
      { guestName: { $regex: q, $options: "i" } },
      { guestEmail: { $regex: q, $options: "i" } },
      { businessName: { $regex: q, $options: "i" } },
    ];
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("business", "businessName logo")
      .populate("customer", "fullName email phone"),
    Booking.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: bookings.map((b) => ({
      ...b.toObject(),
      summary: buildSummary(b.kind, b.details),
    })),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: skip + bookings.length < total,
    },
  });
});

const adminCancelBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error("Booking not found");
  }

  if (["cancelled", "completed", "rejected"].includes(booking.status)) {
    res.status(400);
    throw new Error(`A ${booking.status} booking cannot be cancelled`);
  }

  booking.status = "cancelled";
  booking.cancelledAt = new Date();
  booking.cancelledBy = "admin";
  booking.cancellationReason = isNonEmptyString(req.body?.reason)
    ? String(req.body.reason).trim().slice(0, 1000)
    : "Cancelled by administrator";

  await booking.save();

  await logActivity({
    userId: booking.customer,
    action: "Booking cancelled by admin",
    category: "Bookings",
    detail: `Ref ${booking.referenceCode}. Reason: ${booking.cancellationReason}`,
    status: "error",
    req,
  });

  res.status(200).json({
    success: true,
    message: "Booking cancelled",
    data: booking,
  });
});

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════
export {
  getBookingFormSchema,
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
  getBusinessBookings,
  getBusinessBookingStats,
  confirmBooking,
  rejectBooking,
  completeBooking,
  markBookingNoShow,
  listAllBookings,
  adminCancelBooking,
};