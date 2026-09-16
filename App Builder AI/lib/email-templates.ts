/**
 * Shared branded HTML email template (colorful AppWeaver AI header +
 * consistent card layout) used for every transactional email the app
 * sends — OTP verification codes, feedback notifications, etc. Built with
 * plain inline styles/tables (no Tailwind classes, no externally-hosted
 * images — the logo is embedded as an inline CID attachment) so it renders
 * reliably across Gmail, Outlook, and Apple Mail.
 */

import { BRAND_LOGO_CID } from '@/lib/email';

const ORANGE = '#ff3c00';
const ORANGE_MID = '#ff764c';
const BG = '#faf6f1';
const TEXT_PRIMARY = '#0e0e0f';
const TEXT_MUTED = '#696c74';

function logoBadgeHtml() {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr>
        <td style="padding-right:10px;vertical-align:middle;">
          <img
            src="cid:${BRAND_LOGO_CID}"
            width="34"
            height="34"
            alt="AppWeaver AI"
            style="display:block;width:34px;height:34px;border-radius:10px;" />
        </td>
        <td style="vertical-align:middle;">
          <span style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:19px;font-weight:600;color:#ffffff;">AppWeaver&nbsp;AI</span>
        </td>
      </tr>
    </table>`;
}

export function renderBrandedEmail({
  previewText,
  heading,
  bodyHtml,
  ctaLabel,
  ctaUrl,
}: {
  previewText?: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 4px;">
          <tr>
            <td style="border-radius:999px;background:linear-gradient(135deg, ${ORANGE_MID}, ${ORANGE});">
              <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;font-family:'IBM Plex Sans',Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${ctaLabel}</a>
            </td>
          </tr>
        </table>`
      : '';

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:${BG};font-family:'IBM Plex Sans',Arial,sans-serif;">
    ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.06);">
            <tr>
              <td style="background:linear-gradient(135deg, ${ORANGE_MID}, ${ORANGE});padding:28px 32px;text-align:center;">
                ${logoBadgeHtml()}
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px 32px;">
                <h1 style="margin:0 0 16px;font-family:'IBM Plex Sans',Arial,sans-serif;font-size:22px;font-weight:600;color:${TEXT_PRIMARY};">${heading}</h1>
                <div style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:${TEXT_PRIMARY};">${bodyHtml}</div>
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 28px;border-top:1px solid #f0ece6;">
                <p style="margin:0;font-family:'IBM Plex Sans',Arial,sans-serif;font-size:12px;color:${TEXT_MUTED};">
                  Developed by AppWeaver AI in South Africa. &copy; ${new Date().getFullYear()} AppWeaver AI, Inc.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Large, colorful highlight block used for OTP codes, e.g. verification codes. */
export function highlightCodeHtml(code: string) {
  return `<div style="margin:20px 0;padding:18px 0;text-align:center;border-radius:16px;background:${BG};">
    <span style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:32px;font-weight:700;letter-spacing:8px;color:${ORANGE};">${code}</span>
  </div>`;
}

/** Colorful 1-5 star rating row (filled stars in brand orange). */
export function starRatingHtml(rating: number) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  const stars = Array.from({ length: 5 }, (_, index) =>
    index < filled
      ? `<span style="color:${ORANGE};">&#9733;</span>`
      : `<span style="color:#d8d3cc;">&#9733;</span>`,
  ).join('');
  return `<div style="font-size:22px;letter-spacing:2px;">${stars}</div>`;
}
