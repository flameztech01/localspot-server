// src/utils/resendMail.js
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "LocalSpot <localspot@curriumx.online>";
const REPLY_TO = process.env.RESEND_REPLY_TO || "localspot@curriumx.online";
const APP_NAME = "LocalSpot";
const APP_URL = process.env.CLIENT_URL || "http://localhost:5173";

const IS_DEV = process.env.NODE_ENV !== "production";

// ──────────────────────────────────────────────────────────────
// Shared layout — every email gets the same header/footer frame
// ──────────────────────────────────────────────────────────────
const wrapTemplate = ({ preheader = "", heading, bodyHtml, cta }) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #EEF0F3;">
              <table role="presentation" width="100%">
                <tr>
                  <td style="font-size:14px;font-weight:800;letter-spacing:1.5px;color:#0F172A;">
                    ${APP_NAME.toUpperCase()}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:#0F172A;font-weight:700;">
                ${heading}
              </h1>
              <div style="font-size:14px;line-height:1.65;color:#475569;">
                ${bodyHtml}
              </div>
              ${
                cta
                  ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td style="border-radius:10px;background:#3B82F6;">
                    <a href="${cta.href}" target="_blank" style="display:inline-block;padding:12px 22px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                      ${cta.label}
                    </a>
                  </td>
                </tr>
              </table>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #EEF0F3;background:#FAFBFC;font-size:11px;line-height:1.6;color:#94A3B8;">
              You're receiving this email because you have an account on ${APP_NAME}.<br/>
              Need help? Reply to this email or contact localspot@curriumx.online.
            </td>
          </tr>
        </table>

        <p style="margin:20px 0 0;font-size:11px;color:#94A3B8;">
          &copy; ${new Date().getFullYear()} ${APP_NAME} Systems Ltd.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

// ──────────────────────────────────────────────────────────────
// Low-level sender — never throws, always logs its outcome
// ──────────────────────────────────────────────────────────────
const sendMail = async ({
  to,
  subject,
  heading,
  bodyHtml,
  cta,
  preheader,
  tag = "generic",
}) => {
  if (!to) {
    console.warn(
      `[sendMail:${tag}] SKIPPED — no recipient. subject="${subject || "(none)"}"`
    );
    return { skipped: true, reason: "no recipient" };
  }

  if (!process.env.RESEND_API_KEY) {
    console.error(
      `[sendMail:${tag}] SKIPPED — RESEND_API_KEY is not set in env`
    );
    return { skipped: true, reason: "missing RESEND_API_KEY" };
  }

  try {
    const html = wrapTemplate({ heading, bodyHtml, cta, preheader });

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      reply_to: REPLY_TO,
      subject,
      html,
    });

    if (result?.error) {
      console.error(
        `[sendMail:${tag}] Resend error → ${to}:`,
        result.error
      );
      return { error: result.error };
    }

    if (IS_DEV) {
      console.log(
        `[sendMail:${tag}] sent → ${to} (id=${result?.data?.id || "?"})`
      );
    }

    return { success: true, id: result?.data?.id };
  } catch (err) {
    console.error(
      `[sendMail:${tag}] Unexpected error → ${to}:`,
      err?.message || err
    );
    return { error: err?.message || "unknown" };
  }
};

// ──────────────────────────────────────────────────────────────
// Public helpers — business application / KYC / featured
// ──────────────────────────────────────────────────────────────

export const sendApplicationSubmitted = async ({
  to,
  businessName,
  submittedAt,
}) =>
  sendMail({
    to,
    tag: "application-submitted",
    subject: `Application received — ${APP_NAME}`,
    preheader: `Your business application for "${businessName}" is under review.`,
    heading: "Your business application is under review",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        Thanks for submitting your business application for
        <strong>${businessName}</strong>. Our compliance team is now reviewing
        your details.
      </p>
      <p>
        <strong>Submitted:</strong> ${new Date(
          submittedAt || Date.now()
        ).toLocaleString("en-GB")}
      </p>
      <p>
        The review usually takes <strong>24–48 hours</strong>. We'll email you
        as soon as a decision has been made.
      </p>
    `,
    cta: {
      label: "View your application",
      href: `${APP_URL}/business/verification`,
    },
  });

export const sendApplicationApproved = async ({ to, businessName }) =>
  sendMail({
    to,
    tag: "application-approved",
    subject: `You're approved — ${APP_NAME}`,
    preheader: `Your business "${businessName}" has been approved.`,
    heading: "Your business account is approved 🎉",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        Great news — your business <strong>${businessName}</strong> has been
        approved. You can now access the full merchant dashboard, manage your
        listing, and start receiving customers.
      </p>
      <p>
        <strong>Next step:</strong> complete your KYC verification to earn the
        Verified Trust Badge and boost your search ranking.
      </p>
    `,
    cta: { label: "Go to dashboard", href: `${APP_URL}/business` },
  });

export const sendApplicationRejected = async ({
  to,
  businessName,
  reason,
}) =>
  sendMail({
    to,
    tag: "application-rejected",
    subject: `Action required on your application — ${APP_NAME}`,
    preheader: `Your application for "${businessName}" needs a few fixes.`,
    heading: "Your business application needs attention",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        We reviewed your application for <strong>${businessName}</strong> and
        unfortunately couldn't approve it in its current form.
      </p>
      <p style="padding:14px 16px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:6px;color:#991B1B;">
        <strong>Reason:</strong><br/>
        ${reason || "Please review and update your submission."}
      </p>
      <p>
        You can correct the information and resubmit — no need to start over.
      </p>
    `,
    cta: {
      label: "Fix and resubmit",
      href: `${APP_URL}/business/verification`,
    },
  });

export const sendKYCSubmitted = async ({ to, businessName, submittedAt }) =>
  sendMail({
    to,
    tag: "kyc-submitted",
    subject: `Verification submitted — ${APP_NAME}`,
    preheader: `Your KYC submission for "${businessName}" is under review.`,
    heading: "Your verification submission is under review",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        We've received your KYC documents for <strong>${businessName}</strong>.
        Our compliance team will review them within <strong>24–48 hours</strong>.
      </p>
      <p>
        <strong>Submitted:</strong> ${new Date(
          submittedAt || Date.now()
        ).toLocaleString("en-GB")}
      </p>
      <p>You'll receive an email once the review is complete.</p>
    `,
    cta: {
      label: "Track your verification",
      href: `${APP_URL}/business/verification`,
    },
  });

export const sendKYCApproved = async ({ to, businessName }) =>
  sendMail({
    to,
    tag: "kyc-approved",
    subject: `Trust Badge issued — ${APP_NAME}`,
    preheader: `Your business "${businessName}" is now verified.`,
    heading: "You're now a Verified Business 🎉",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        Congratulations! <strong>${businessName}</strong> has passed compliance
        review. Your <strong>Verified Trust Badge</strong> is now live on your
        public listing.
      </p>
      <p>What this unlocks:</p>
      <ul style="margin:8px 0 0;padding-left:20px;color:#475569;">
        <li>Higher search ranking</li>
        <li>Verified badge on your listing</li>
        <li>Customer trust and higher conversions</li>
        <li>Merchant payouts eligibility</li>
      </ul>
    `,
    cta: { label: "View your listing", href: `${APP_URL}/business` },
  });

export const sendKYCRejected = async ({ to, businessName, reason }) =>
  sendMail({
    to,
    tag: "kyc-rejected",
    subject: `Verification needs attention — ${APP_NAME}`,
    preheader: `Your KYC submission for "${businessName}" was rejected.`,
    heading: "Your KYC submission needs a few fixes",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        We reviewed your KYC submission for <strong>${businessName}</strong>
        and couldn't approve it in its current form.
      </p>
      <p style="padding:14px 16px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:6px;color:#991B1B;">
        <strong>Reason:</strong><br/>
        ${reason || "Please review your documents and resubmit."}
      </p>
      <p>
        Correct the issue and resubmit — your previous work is preserved.
      </p>
    `,
    cta: {
      label: "Resubmit verification",
      href: `${APP_URL}/business/verification`,
    },
  });

export const sendBusinessFeatured = async ({
  to,
  businessName,
  plan,
  until,
}) =>
  sendMail({
    to,
    tag: "business-featured",
    subject: `Your listing is now featured — ${APP_NAME}`,
    preheader: `${businessName} is now featured on LocalSpot.`,
    heading: "Your business is now featured ⭐",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        <strong>${businessName}</strong> is now a featured listing on
        ${APP_NAME}. Expect more views, clicks, and calls from local customers.
      </p>
      ${
        plan
          ? `<p><strong>Plan:</strong> ${
              plan.charAt(0).toUpperCase() + plan.slice(1)
            }</p>`
          : ""
      }
      ${
        until
          ? `<p><strong>Featured until:</strong> ${new Date(
              until
            ).toLocaleDateString("en-GB")}</p>`
          : ""
      }
    `,
    cta: { label: "View your listing", href: `${APP_URL}/business` },
  });

// ──────────────────────────────────────────────────────────────
// Booking emails
// ──────────────────────────────────────────────────────────────

// Shared block: reference + summary + start time
const bookingDetailsBlock = ({ referenceCode, summary, startAt }) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">
    <tr>
      <td style="padding:16px 18px;">
        <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.5px;color:#64748B;text-transform:uppercase;font-weight:700;">
          Reference
        </p>
        <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#0F172A;letter-spacing:0.5px;">
          ${referenceCode || "—"}
        </p>
        <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.5px;color:#64748B;text-transform:uppercase;font-weight:700;">
          Details
        </p>
        <p style="margin:0;font-size:14px;color:#334155;">
          ${summary || "—"}
        </p>
        ${
          startAt
            ? `<p style="margin:8px 0 0;font-size:13px;color:#64748B;">
                 <strong>When:</strong> ${new Date(startAt).toLocaleString(
                   "en-GB"
                 )}
               </p>`
            : ""
        }
      </td>
    </tr>
  </table>
`;

// Sent to the BUSINESS when a new booking request comes in
export const sendBookingReceived = async ({
  to,
  businessName,
  guestName,
  guestEmail,
  guestPhone,
  referenceCode,
  kind,
  summary,
  specialRequests,
  startAt,
}) =>
  sendMail({
    to,
    tag: "booking-received",
    subject: `New booking request — ${APP_NAME}`,
    preheader: `${guestName} requested a booking (Ref ${referenceCode}).`,
    heading: "You have a new booking request",
    bodyHtml: `
      <p>Hi ${businessName || "there"},</p>
      <p>
        <strong>${guestName}</strong> has sent a booking request through
        ${APP_NAME}. Log in to confirm, reject, or reply.
      </p>
      ${bookingDetailsBlock({ referenceCode, summary, startAt })}
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.5px;color:#64748B;text-transform:uppercase;font-weight:700;">
        Contact
      </p>
      <ul style="margin:0 0 8px;padding-left:20px;color:#334155;">
        <li>Email: <a href="mailto:${guestEmail}" style="color:#3B82F6;text-decoration:none;">${
          guestEmail || "—"
        }</a></li>
        <li>Phone: ${guestPhone || "—"}</li>
      </ul>
      ${
        specialRequests
          ? `<p style="padding:12px 14px;background:#EFF6FF;border-left:3px solid #3B82F6;border-radius:6px;color:#1E3A8A;margin:12px 0;">
               <strong>Special requests:</strong><br/>${specialRequests}
             </p>`
          : ""
      }
      <p>Respond quickly — customers appreciate a fast turnaround.</p>
    `,
    cta: { label: "Manage booking", href: `${APP_URL}/business/bookings` },
  });

// Sent to the CUSTOMER when they submit a booking request
export const sendBookingRequestSubmitted = async ({
  to,
  businessName,
  guestName,
  referenceCode,
  kind,
  summary,
  startAt,
}) =>
  sendMail({
    to,
    tag: "booking-request-submitted",
    subject: `Booking request sent — ${businessName || APP_NAME}`,
    preheader: `We've sent your request to ${businessName} (Ref ${referenceCode}).`,
    heading: "Your booking request has been sent ✅",
    bodyHtml: `
      <p>Hi ${guestName || "there"},</p>
      <p>
        We've passed your request on to
        <strong>${businessName}</strong>. They'll review it and respond
        shortly — you'll get another email the moment they confirm or decline.
      </p>
      ${bookingDetailsBlock({ referenceCode, summary, startAt })}
      <p style="font-size:13px;color:#64748B;">
        If you don't hear back within 24 hours, you can reach the business
        directly from your bookings dashboard.
      </p>
    `,
    cta: {
      label: "View your bookings",
      href: `${APP_URL}/bookings`,
    },
  });

// Sent to the CUSTOMER when the business confirms
export const sendBookingConfirmed = async ({
  to,
  businessName,
  guestName,
  referenceCode,
  kind,
  summary,
  startAt,
  businessNotes,
}) =>
  sendMail({
    to,
    tag: "booking-confirmed",
    subject: `Booking confirmed — ${businessName || APP_NAME}`,
    preheader: `Your booking with ${businessName} is confirmed.`,
    heading: "Your booking is confirmed ✅",
    bodyHtml: `
      <p>Hi ${guestName || "there"},</p>
      <p>
        Great news — <strong>${businessName}</strong> has confirmed your
        booking. Here are the details:
      </p>
      ${bookingDetailsBlock({ referenceCode, summary, startAt })}
      ${
        businessNotes
          ? `<p style="padding:12px 14px;background:#ECFDF5;border-left:3px solid #10B981;border-radius:6px;color:#065F46;margin:12px 0;">
               <strong>Note from ${businessName}:</strong><br/>${businessNotes}
             </p>`
          : ""
      }
      <p>
        Need to change something? Contact the business directly or cancel
        from your dashboard at least 24 hours before the start time.
      </p>
    `,
    cta: {
      label: "View booking",
      href: `${APP_URL}/bookings/${referenceCode}`,
    },
  });

// Sent to the CUSTOMER when the business rejects
export const sendBookingRejected = async ({
  to,
  businessName,
  guestName,
  referenceCode,
  reason,
}) =>
  sendMail({
    to,
    tag: "booking-rejected",
    subject: `Booking declined — ${businessName || APP_NAME}`,
    preheader: `Your booking request with ${businessName} was declined.`,
    heading: "Your booking request was declined",
    bodyHtml: `
      <p>Hi ${guestName || "there"},</p>
      <p>
        Unfortunately <strong>${businessName}</strong> couldn't accommodate
        your booking request at this time.
      </p>
      <p style="padding:12px 14px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:6px;color:#991B1B;margin:12px 0;">
        <strong>Reason:</strong><br/>
        ${reason || "No reason provided."}
      </p>
      <p style="font-size:13px;color:#64748B;">
        Reference: <strong>${referenceCode || "—"}</strong>
      </p>
      <p>
        Try a different time or explore other similar businesses nearby.
      </p>
    `,
    cta: { label: "Find alternatives", href: `${APP_URL}/explore` },
  });

// Sent when a booking is cancelled — business OR customer side
export const sendBookingCancelled = async ({
  to,
  businessName,
  guestName,
  referenceCode,
  cancelledBy = "customer",
  reason,
}) =>
  sendMail({
    to,
    tag: "booking-cancelled",
    subject: `Booking cancelled — ${APP_NAME}`,
    preheader: `Booking ${referenceCode} was cancelled by the ${cancelledBy}.`,
    heading: "Booking cancelled",
    bodyHtml: `
      <p>Hi,</p>
      <p>
        The booking with <strong>${businessName || "the business"}</strong>
        ${guestName ? `for <strong>${guestName}</strong>` : ""} has been
        cancelled by the <strong>${cancelledBy}</strong>.
      </p>
      <p style="padding:12px 14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;color:#334155;margin:12px 0;">
        <strong>Reference:</strong> ${referenceCode || "—"}
      </p>
      ${
        reason
          ? `<p style="padding:12px 14px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:6px;color:#991B1B;margin:12px 0;">
               <strong>Reason:</strong><br/>${reason}
             </p>`
          : ""
      }
      <p>No further action is required. You're welcome to book again anytime.</p>
    `,
    cta: { label: "Browse businesses", href: `${APP_URL}/explore` },
  });

export default sendMail;