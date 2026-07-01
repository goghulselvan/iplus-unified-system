import { BrandAssets, DEFAULT_BRAND_ASSETS } from '@/hooks/useBrandAssets';

export interface EmailTemplate {
  subject: string;
  body: string;
}

/**
 * Generate branded email HTML with iPlus branding
 * Includes logo, brand colors, and professional MNC styling
 */
export function generateBrandedEmailHTML(
  contentHTML: string,
  brandAssets: BrandAssets = DEFAULT_BRAND_ASSETS,
  schoolName?: string
): string {
  const { colors, logo_horizontal_url, tagline } = brandAssets;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
        }
        .email-container {
            max-width: 600px;
            margin: 20px auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .email-header {
            background: linear-gradient(135deg, ${colors.dark_blue} 0%, ${colors.primary} 100%);
            padding: 30px 20px;
            text-align: center;
            border-bottom: 4px solid ${colors.accent};
        }
        .email-logo {
            max-height: 80px;
            margin-bottom: 15px;
        }
        .email-tagline {
            color: ${colors.accent};
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 1px;
            text-transform: uppercase;
            margin: 10px 0 0 0;
        }
        .email-content {
            padding: 40px 30px;
        }
        .email-content h1 {
            color: ${colors.dark_blue};
            font-size: 24px;
            margin-top: 0;
            margin-bottom: 20px;
        }
        .email-content h2 {
            color: ${colors.primary};
            font-size: 18px;
            margin-top: 25px;
            margin-bottom: 15px;
        }
        .email-content p {
            margin: 12px 0;
            color: #555;
        }
        .email-content ul,
        .email-content ol {
            margin: 15px 0;
            padding-left: 20px;
        }
        .email-content li {
            margin: 8px 0;
        }
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%);
            color: white;
            padding: 12px 30px;
            border-radius: 4px;
            text-decoration: none;
            font-weight: 600;
            margin: 20px 0;
            transition: all 0.3s ease;
        }
        .cta-button:hover {
            opacity: 0.9;
            text-decoration: none;
        }
        .highlight {
            background-color: #fff3cd;
            color: ${colors.dark_blue};
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 500;
        }
        .email-footer {
            background-color: #f9f9f9;
            border-top: 1px solid #e0e0e0;
            padding: 25px 30px;
            font-size: 12px;
            color: #888;
            text-align: center;
        }
        .footer-logo {
            max-height: 40px;
            margin: 15px 0;
        }
        .divider {
            height: 2px;
            background: linear-gradient(90deg, transparent, ${colors.accent}, transparent);
            margin: 25px 0;
        }
        .school-name {
            color: ${colors.secondary};
            font-weight: 600;
        }
        @media only screen and (max-width: 600px) {
            .email-container {
                margin: 0;
                border-radius: 0;
            }
            .email-content {
                padding: 20px 15px;
            }
            .email-content h1 {
                font-size: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header -->
        <div class="email-header">
            ${logo_horizontal_url ? `<img src="${logo_horizontal_url}" alt="iPlus Olympiads" class="email-logo" style="max-width: 100%; height: auto;">` : `<div style="color: white; font-size: 28px; font-weight: bold;">iPlus OLYMPIADS</div>`}
            <div class="email-tagline">${tagline}</div>
        </div>

        <!-- Content -->
        <div class="email-content">
            ${schoolName ? `<p style="text-align: center; color: ${colors.secondary}; font-size: 14px; margin-bottom: 20px;">Dear <span class="school-name">${escapeHtml(schoolName)}</span>,</p>` : ''}
            ${contentHTML}
        </div>

        <!-- Footer -->
        <div class="email-footer">
            <div class="divider"></div>
            <p style="margin: 10px 0;">
                <strong>iPlus Olympiads</strong><br>
                Igniting Genius, Inspiring Excellence, Impacting the Future
            </p>
            <p style="margin: 10px 0; color: #999;">
                115, GST Road, Guduvancheri, Chennai 603 202<br>
                📞 +91 81110 66556 | 📧 contact@iplusedu.in
            </p>
            <p style="margin: 15px 0 0 0; font-size: 11px; color: #bbb;">
                This is an automated message from iPlus Olympiads. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>
  `.trim();
}

/**
 * Generate branded text email (plain text fallback)
 */
export function generateBrandedEmailText(
  contentText: string,
  schoolName?: string,
  tagline = 'Ignite Inspire Impact'
): string {
  return `
iPlus OLYMPIADS
${tagline}

${schoolName ? `Dear ${schoolName},\n` : ''}

${contentText}

---

iPlus Olympiads
Igniting Genius, Inspiring Excellence, Impacting the Future

115, GST Road, Guduvancheri, Chennai 603 202
📞 +91 81110 66556 | 📧 contact@iplusedu.in

This is an automated message from iPlus Olympiads. Please do not reply to this email.
  `.trim();
}

/**
 * Escape HTML special characters for safe insertion
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Apply variable interpolation to email template
 * Replaces {variable_name} with actual values
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string | number>
): string {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, String(value));
  });
  return result;
}

/**
 * Combine all email generation steps with branding
 */
export function generateFinalEmail(
  contentHTML: string,
  variables: Record<string, string | number> = {},
  schoolName?: string,
  brandAssets: BrandAssets = DEFAULT_BRAND_ASSETS
): { subject: string; html: string; text: string } {
  // Interpolate variables in content
  const interpolatedHTML = interpolateTemplate(contentHTML, variables);

  // Generate branded email
  const html = generateBrandedEmailHTML(interpolatedHTML, brandAssets, schoolName);
  const text = generateBrandedEmailText(
    contentHTML.replace(/<[^>]*>/g, ''),
    schoolName,
    brandAssets.tagline
  );

  return {
    subject: interpolateTemplate(brandAssets.tagline || 'Message from iPlus Olympiads', variables),
    html,
    text,
  };
}
