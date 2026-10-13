// src/utils/logActivity.js
import ActivityLog from "../models/activityLogModel.js";

export const logActivity = async ({
  userId,
  action,
  category = "System",
  detail = "",
  status = "info",
  meta,
  req,
}) => {
  try {
    const ip =
      req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req?.ip ||
      req?.socket?.remoteAddress ||
      "";
    const userAgent = req?.headers?.["user-agent"] || "";

    await ActivityLog.create({
      user: userId,
      action,
      category,
      detail,
      status,
      meta,
      ip,
      userAgent,
    });
  } catch (err) {
    // Never let logging break the main flow
    console.error("[logActivity]", err.message);
  }
};