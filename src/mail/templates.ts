/**
 * HTML email templates for outbound mail.
 *
 * All templates are inline-styled (no external CSS) for maximum email-client
 * compatibility. Colors align with the Luminous brand default (blue family).
 *
 * Emails are bilingual (Chinese + English) so they work for all users
 * regardless of locale preference.
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

// ── Language separator ───────────────────────────────────────────────

/**
 * Thin horizontal divider used to separate Chinese and English sections.
 */
const LANG_DIVIDER = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;"><tr><td style="border-top:1px solid ${BRAND_BORDER};padding:0;"></td></tr></table>`;

// ── Email shell ──────────────────────────────────────────────────────

/**
 * Wraps inner content in a responsive email-safe shell with header and footer.
 *
 * Uses table-based layout for Outlook compatibility. All styles are inline.
 */
function emailShell(innerContent: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
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
              <p style="margin:6px 0 0 0;color:rgba(255,255,255,0.8);font-size:13px;font-weight:400;">${BRAND_TAGLINE_ZH} &middot; ${BRAND_TAGLINE_EN}</p>
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
                这是一封自动发送的邮件，请勿直接回复。<br>
                This is an automated email, please do not reply.
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

// ── Verification code email ──────────────────────────────────────────

/**
 * Bilingual subject line for the verification code email.
 */
export const VERIFICATION_CODE_SUBJECT = `${BRAND_NAME} - 邮箱验证码 / Email Verification Code`;

/**
 * Renders the verification code email HTML (bilingual: Chinese + English).
 *
 * @param code - The verification code (typically 6 digits)
 * @param ttlMinutes - Code validity in minutes (default: 5)
 */
export function renderVerificationCodeEmail(
  code: string,
  ttlMinutes = 5,
): string {
  const inner = `
              <!-- ── Chinese section ── -->

              <p style="margin:0 0 24px 0;color:${BRAND_TEXT};font-size:16px;line-height:1.7;">
                您好！您正在进行邮箱验证。
              </p>

              <p style="margin:0 0 8px 0;color:${BRAND_TEXT_MUTED};font-size:14px;line-height:1.6;">
                您的验证码是：
              </p>

              <!-- Code box (shared) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px 0;">
                <tr>
                  <td style="background-color:${BRAND_PRIMARY_LIGHT};border:1px solid #BFDBFE;border-radius:12px;padding:28px 24px;text-align:center;">
                    <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:${BRAND_PRIMARY};font-family:'SF Mono','Fira Code','Courier New',monospace;">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Tips (zh) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#FEFCE8;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
                      &bull; 验证码 ${String(ttlMinutes)} 分钟内有效<br>
                      &bull; 请勿将验证码泄露给他人
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:${BRAND_TEXT_MUTED};font-size:13px;line-height:1.6;">
                如果您没有发起此操作，请忽略此邮件，您的账户安全不会受到影响。
              </p>

              <!-- ── Language divider ── -->

              <div style="margin:28px 0;">${LANG_DIVIDER}</div>

              <!-- ── English section ── -->

              <p style="margin:0 0 24px 0;color:${BRAND_TEXT};font-size:16px;line-height:1.7;">
                Hello! You are verifying your email address.
              </p>

              <p style="margin:0 0 8px 0;color:${BRAND_TEXT_MUTED};font-size:14px;line-height:1.6;">
                Your verification code is:
              </p>

              <!-- Tips (en) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#FEFCE8;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
                      &bull; The code expires in ${String(ttlMinutes)} minutes<br>
                      &bull; Do not share this code with anyone
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:${BRAND_TEXT_MUTED};font-size:13px;line-height:1.6;">
                If you did not request this, please ignore this email. Your account security will not be affected.
              </p>`;

  return emailShell(inner);
}
