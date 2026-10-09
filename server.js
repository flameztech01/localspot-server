import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { notFound, errorHandler } from './middleware/errorMiddleware.js';


import businessRoutes from './routes/businessRoutes.js';
import discoveryRoutes from "./routes/discoveryRoutes.js";
import promotionRoutes from "./routes/promotionRoutes.js";
import adminPromotionRoutes from "./routes/adminPromotionRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import adsRoutes from "./routes/adsRoutes.js";
import adminAdsRoutes from "./routes/adminAdsRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import businessReviewRoutes from "./routes/businessReviewRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import savedPlaceRoutes from "./routes/savedPlaceRoutes.js";

const app = express();
dotenv.config();



const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/myapp';

// ─── CORS ──────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://localhost',
  'http://localhost:1010',
  'https://localspot-sage.vercel.app',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`❌ CORS blocked origin: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

// ─── JSON & URL‑encoded parsers ─────────────────────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Routes ──────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("localspot API is running 🚀");
});

app.use('/api/v1/auth/business', businessRoutes);
app.use("/api/v1/discovery", discoveryRoutes);
app.use("/api/v1/promotions/admin", adminPromotionRoutes);
app.use("/api/v1/promotions", promotionRoutes);
app.use("/api/v1/location", locationRoutes);
app.use("/api/advertisements/admin", adminAdsRoutes);
app.use("/api/advertisements", adsRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/business/reviews", businessReviewRoutes);
app.use("/api/v1/reviews", reviewRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/saved-places", savedPlaceRoutes);


// ─── Error handling ──────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── MongoDB connection ──────────────────────────────────────────
mongoose
  .connect(MONGO_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));