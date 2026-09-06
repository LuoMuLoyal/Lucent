/**
 * HTML email templates for outbound mail.
 *
 * All templates are inline-styled (no external CSS) for maximum email-client
 * compatibility. Colors align with the Luminous brand default (blue family).
 *
 * Emails are rendered in a single language determined by the request locale
 * (`Accept-Language`), passed through the send/mail queue as an ISO locale
 * string. English is the fallback when the locale is unsupported.
 */

// ── Brand constants ──────────────────────────────────────────────────

export const BRAND_NAME = 'Luminous';
const BRAND_TAGLINE_ZH = '您的智能健康管理伙伴';
const BRAND_TAGLINE_EN = 'Your smart health companion';
const BRAND_PRIMARY = '#1447E6';
const BRAND_PRIMARY_DARK = '#0B2FBE';
const BRAND_PRIMARY_LIGHT = '#EFF6FF';
const BRAND_TEXT = '#1E293B';
const BRAND_TEXT_MUTED = '#64748B';
const BRAND_BG = '#F8FAFC';
const BRAND_BORDER = '#E2E8F0';
const BRAND_WHITE = '#FFFFFF';

/** Supported email locales; anything else falls back to English. */
type EmailLocale = 'zh-CN' | 'en';

function resolveLocale(locale: string | undefined): EmailLocale {
  if (locale === 'zh-CN' || locale === 'zh') {
    return 'zh-CN';
  }
  return 'en';
}

// ── Email shell ──────────────────────────────────────────────────────

/**
 * Wraps inner content in a responsive email-safe shell with header and footer.
 *
 * Uses table-based layout for Outlook compatibility. All styles are inline.
 */
function emailShell(innerContent: string, locale: EmailLocale): string {
  const tagline =
    locale === 'zh-CN' ? BRAND_TAGLINE_ZH : BRAND_TAGLINE_EN;
  const footerNote =
    locale === 'zh-CN'
      ? '这是一封自动发送的邮件，请勿直接回复。'
      : 'This is an automated email, please do not reply.';
  const htmlLang = locale === 'zh-CN' ? 'zh-CN' : 'en';

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${BRAND_NAME}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND_BG};min-width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${BRAND_WHITE};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_PRIMARY} 0%,${BRAND_PRIMARY_DARK} 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:${BRAND_WHITE};font-size:24px;font-weight:700;letter-spacing:0.5px;">${BRAND_NAME}</h1>
              <p style="margin:6px 0 0 0;color:rgba(255,255,255,0.8);font-size:13px;font-weight:400;">${tagline}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:40px;">
              ${innerContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px 40px;background-color:${BRAND_BG};border-top:1px solid ${BRAND_BORDER};">
              <p style="margin:0 0 8px 0;color:${BRAND_TEXT_MUTED};font-size:12px;line-height:1.6;text-align:center;">
                ${footerNote}
              </p>
              <p style="margin:0;color:${BRAND_TEXT_MUTED};font-size:12px;line-height:1.6;text-align:center;">
                &copy; ${String(new Date().getFullYear())} ${BRAND_NAME}. All rights reserved.
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

// ── Shared call-to-action button ───────────────────────────────────────

/**
 * Renders a centered primary button pointing to the given URL.
 */
function ctaButton(label: string, url: string): string {
  return `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 32px;background-color:${BRAND_PRIMARY};color:${BRAND_WHITE};text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;">
                      ${label}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;color:${BRAND_TEXT_MUTED};font-size:12px;line-height:1.6;word-break:break-all;text-align:center;">
                ${escapeHtml(url)}
              </p>`;
}

/** Basic HTML attribute escaping for URLs and plain text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Verification code email ────────────────────────────────────────────

/** Locale-aware subject line for the verification code email. */
export function verificationCodeSubject(locale?: string): string {
  const resolved = resolveLocale(locale);
  return resolved === 'zh-CN'
    ? `${BRAND_NAME} - 邮箱验证码`
    : `${BRAND_NAME} - Email Verification Code`;
}

/** Locale-aware greeting line for the verification code email. */
function verificationGreeting(locale: EmailLocale): string {
  return locale === 'zh-CN'
    ? '您好！您正在进行邮箱验证。'
    : 'Hello! You are verifying your email address.';
}

/** Locale-aware "your code is" label for the verification code email. */
function verificationCodeLabel(locale: EmailLocale): string {
  return locale === 'zh-CN' ? '您的验证码是：' : 'Your verification code is:';
}

/** Locale-aware expiry hint for the verification code email. */
function verificationExpiryNote(locale: EmailLocale, ttlMinutes: number): string {
  return locale === 'zh-CN'
    ? `验证码 ${String(ttlMinutes)} 分钟内有效`
    : `The code expires in ${String(ttlMinutes)} minutes`;
}

/** Locale-aware "do not share" hint for the verification code email. */
function verificationShareNote(locale: EmailLocale): string {
  return locale === 'zh-CN'
    ? '请勿将验证码泄露给他人'
    : 'Do not share this code with anyone';
}

/** Locale-aware "ignore if not you" note for the verification code email. */
function verificationIgnoreNote(locale: EmailLocale): string {
  return locale === 'zh-CN'
    ? '如果您没有发起此操作，请忽略此邮件，您的账户安全不会受到影响。'
    : 'If you did not request this, please ignore this email. Your account security will not be affected.';
}

/**
 * Renders the verification code email HTML in a single language.
 *
 * The language is chosen from the request locale (`Accept-Language`) so the
 * email matches the language the user is using in the product. English is the
 * fallback for unsupported locales.
 *
 * @param code - The verification code (typically 6 digits)
 * @param ttlMinutes - Code validity in minutes (default: 5)
 * @param locale - Request locale (default: en)
 */
export function renderVerificationCodeEmail(
  code: string,
  ttlMinutes = 5,
  locale?: string,
): string {
  const lang = resolveLocale(locale);
  const inner = `
              <p style="margin:0 0 24px 0;color:${BRAND_TEXT};font-size:16px;line-height:1.7;">
                ${verificationGreeting(lang)}
              </p>

              <p style="margin:0 0 8px 0;color:${BRAND_TEXT_MUTED};font-size:14px;line-height:1.6;">
                ${verificationCodeLabel(lang)}
              </p>

              <!-- Code box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px 0;">
                <tr>
                  <td style="background-color:${BRAND_PRIMARY_LIGHT};border:1px solid #BFDBFE;border-radius:12px;padding:28px 24px;text-align:center;">
                    <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:${BRAND_PRIMARY};font-family:'SF Mono','Fira Code','Courier New',monospace;">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Tips -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#FEFCE8;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
                      &bull; ${verificationExpiryNote(lang, ttlMinutes)}<br>
                      &bull; ${verificationShareNote(lang)}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:${BRAND_TEXT_MUTED};font-size:13px;line-height:1.6;">
                ${verificationIgnoreNote(lang)}
              </p>`;

  return emailShell(inner, lang);
}

// ── Verification link email ──────────────────────────────────────────

/** Locale-aware subject line for the verification link email. */
export function verificationLinkSubject(locale?: string): string {
  const resolved = resolveLocale(locale);
  return resolved === 'zh-CN'
    ? `${BRAND_NAME} - 验证您的邮箱`
    : `${BRAND_NAME} - Verify Your Email`;
}

/** Locale-aware greeting line for the verification link email. */
function linkGreeting(locale: EmailLocale): string {
  return locale === 'zh-CN'
    ? '您好！请验证您的邮箱地址以完成账户设置。'
    : 'Hello! Please verify your email address to complete your account setup.';
}

/** Locale-aware link button label for the verification link email. */
function linkCtaLabel(locale: EmailLocale): string {
  return locale === 'zh-CN' ? '验证邮箱' : 'Verify Email';
}

/** Locale-aware expiry hint for the verification link email. */
function linkExpiryNote(locale: EmailLocale, ttlMinutes: number): string {
  return locale === 'zh-CN'
    ? `链接 ${String(ttlMinutes)} 分钟内有效`
    : `The link expires in ${String(ttlMinutes)} minutes`;
}

/** Locale-aware "do not share" hint for the verification link email. */
function linkShareNote(locale: EmailLocale): string {
  return locale === 'zh-CN'
    ? '请勿将此链接分享给他人'
    : 'Do not share this link with anyone';
}

/**
 * Renders an email containing a one-time link to verify the email address,
 * in a single language chosen from the request locale (default: en).
 *
 * @param url - The verification link (contains the token)
 * @param ttlMinutes - Link validity in minutes (default: 60)
 * @param locale - Request locale (default: en)
 */
export function renderVerificationLinkEmail(
  url: string,
  ttlMinutes = 60,
  locale?: string,
): string {
  const lang = resolveLocale(locale);
  const inner = `
              <p style="margin:0 0 24px 0;color:${BRAND_TEXT};font-size:16px;line-height:1.7;">
                ${linkGreeting(lang)}
              </p>

              ${ctaButton(linkCtaLabel(lang), url)}

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#FEFCE8;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
                      &bull; ${linkExpiryNote(lang, ttlMinutes)}<br>
                      &bull; ${linkShareNote(lang)}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:${BRAND_TEXT_MUTED};font-size:13px;line-height:1.6;">
                ${verificationIgnoreNote(lang)}
              </p>`;

  return emailShell(inner, lang);
}
