import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM || "localspot@curriumx.online";

const SUBJECTS = {
  verification: "Verify your business account",
  "password-reset": "Reset your password",
};

const HEADINGS = {
  verification: "Welcome aboard!",
  "password-reset": "Password reset request",
};

const BODIES = {
  verification:
    "Use the code below to verify your business account. It expires in 10 minutes.",
  "password-reset":
    "Use the code below to reset your password. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.",
};

export const sendOTPEmail = async ({ to, otp, purpose = "verification" }) => {
  if (!SUBJECTS[purpose]) {
    throw new Error(`Unsupported OTP purpose: ${purpose}`);
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111827;">
      <h2 style="margin: 0 0 8px; font-size: 20px;">${HEADINGS[purpose]}</h2>
      <p style="margin: 0 0 24px; color: #4b5563; font-size: 14px;">${BODIES[purpose]}</p>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; text-align: center;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${otp}</span>
      </div>
      <p style="margin: 24px 0 0; color: #9ca3af; font-size: 12px;">This code will expire in 10 minutes.</p>
    </div>
  `;

  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject: SUBJECTS[purpose],
    html,
  });

  if (error) {
    console.error("[resendOTP] send failed:", error);
    throw new Error("Failed to send OTP email");
  }

  return { success: true, id: data?.id };
};