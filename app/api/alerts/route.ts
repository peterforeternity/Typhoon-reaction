import {
  type AlertMatch,
  type AlertRules,
  evaluateAlertRules,
  getTyphoonDashboard,
} from "@/lib/typhoon";

export const runtime = "edge";

type DeliveryStatus = "clear" | "dry_run" | "sent" | "failed" | "skipped";

interface AlertRequest {
  rules?: Partial<AlertRules>;
  dryRun?: boolean;
}

export async function GET() {
  return Response.json({
    provider: emailProviderName(),
    configured: isEmailConfigured(),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as AlertRequest;
  const rules = normalizeRules(body.rules);
  const dashboard = await getTyphoonDashboard();
  const matches = evaluateAlertRules(dashboard.typhoons, rules);

  if (matches.length === 0) {
    return Response.json({
      status: "clear" satisfies DeliveryStatus,
      message: "当前未触发预警条件",
      matches,
      source: dashboard.source,
    });
  }

  const delivery = await deliverAlert(matches, rules, body.dryRun === true);

  return Response.json({
    status: delivery.status,
    message: delivery.message,
    provider: delivery.provider,
    matches,
    source: dashboard.source,
  });
}

function normalizeRules(raw: Partial<AlertRules> | undefined): AlertRules {
  const envRecipients = splitRecipients(process.env.ALERT_TO ?? "");
  const recipients = raw?.recipients?.length ? raw.recipients : envRecipients;

  return {
    recipients,
    minWindEnabled: raw?.minWindEnabled ?? true,
    minWindKmh: numberOr(raw?.minWindKmh, 63),
    categoryEnabled: raw?.categoryEnabled ?? true,
    categoryRank: numberOr(raw?.categoryRank, 2),
    proximityEnabled: raw?.proximityEnabled ?? true,
    watchLatitude: numberOr(raw?.watchLatitude, 22.3),
    watchLongitude: numberOr(raw?.watchLongitude, 114.2),
    radiusKm: numberOr(raw?.radiusKm, 600),
    rapidIntensityEnabled: raw?.rapidIntensityEnabled ?? true,
    trendKmh: numberOr(raw?.trendKmh, 20),
  };
}

async function deliverAlert(
  matches: AlertMatch[],
  rules: AlertRules,
  dryRun: boolean,
): Promise<{
  status: DeliveryStatus;
  message: string;
  provider: string;
}> {
  if (rules.recipients.length === 0) {
    return {
      status: "skipped",
      message: "未配置收件邮箱，预警已生成但未发送",
      provider: "none",
    };
  }

  const provider = emailProviderName();
  const subject = `台风预警：${matches.map((match) => match.typhoonName).join("、")}`;
  const text = matches
    .map(
      (match) =>
        `${match.warningLevel}｜${match.typhoonName}\n` +
        `当前风速：${match.currentWindKmh} km/h\n` +
        `预报峰值：${match.forecastPeakWindKmh} km/h\n` +
        `距关注点：${match.distanceKm ?? "未计算"} km\n` +
        `预计影响：${formatWindow(match.expectedImpactStart, match.expectedImpactEnd)}\n` +
        `影响区域：${match.impactRegions.join("、") || "暂无已识别重点陆地区域"}\n\n` +
        `触发原因：\n${match.reasons.map((reason) => `- ${reason}`).join("\n")}\n\n` +
        `防御建议：\n${match.recommendations.map((item) => `- ${item}`).join("\n")}`,
    )
    .join("\n\n");
  const html = buildEmailHtml(matches);

  if (dryRun || !isEmailConfigured()) {
    return {
      status: "dry_run",
      message:
        "邮件服务未配置或处于演练模式，预警内容已生成但没有对外发送",
      provider,
    };
  }

  try {
    if (process.env.RESEND_API_KEY && process.env.ALERT_FROM) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.ALERT_FROM,
          to: rules.recipients,
          subject,
          text,
          html,
        }),
      });

      if (!response.ok) {
        throw new Error(`Resend returned ${response.status}`);
      }
    } else if (process.env.EMAIL_WEBHOOK_URL) {
      const response = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: rules.recipients,
          subject,
          text,
          html,
          matches,
        }),
      });

      if (!response.ok) {
        throw new Error(`Email webhook returned ${response.status}`);
      }
    }

    return {
      status: "sent",
      message: `预警邮件已发送至 ${rules.recipients.join("、")}`,
      provider,
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error ? error.message : "邮件发送失败，请检查服务配置",
      provider,
    };
  }
}

function buildEmailHtml(matches: AlertMatch[]): string {
  const rows = matches
    .map(
      (match) => `<section style="margin:0 0 18px;border:1px solid #d7e1de;border-radius:8px;overflow:hidden">
  <div style="padding:14px 16px;background:#17313b;color:#fff">
    <p style="margin:0 0 4px;font-size:12px;opacity:.8">${escapeHtml(match.warningLevel)}</p>
    <h2 style="margin:0;font-size:20px">${escapeHtml(match.typhoonName)}</h2>
  </div>
  <div style="padding:16px">
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <tr><td style="padding:6px 0;color:#60706c">当前风速</td><td style="padding:6px 0;text-align:right;font-weight:700">${match.currentWindKmh} km/h</td></tr>
      <tr><td style="padding:6px 0;color:#60706c">预报峰值</td><td style="padding:6px 0;text-align:right;font-weight:700">${match.forecastPeakWindKmh} km/h</td></tr>
      <tr><td style="padding:6px 0;color:#60706c">距关注点</td><td style="padding:6px 0;text-align:right;font-weight:700">${match.distanceKm ?? "未计算"} km</td></tr>
      <tr><td style="padding:6px 0;color:#60706c">预计影响</td><td style="padding:6px 0;text-align:right;font-weight:700">${escapeHtml(formatWindow(match.expectedImpactStart, match.expectedImpactEnd))}</td></tr>
    </table>
    <h3 style="margin:0 0 7px;font-size:14px;color:#17313b">影响区域</h3>
    <p style="margin:0 0 14px;line-height:1.6">${escapeHtml(match.impactRegions.join("、") || "暂无已识别重点陆地区域")}</p>
    <h3 style="margin:0 0 7px;font-size:14px;color:#17313b">触发原因</h3>
    <ul style="margin:0 0 14px;padding-left:20px">${match.reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("")}</ul>
    <h3 style="margin:0 0 7px;font-size:14px;color:#17313b">建议措施</h3>
    <ul style="margin:0;padding-left:20px">${match.recommendations
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ul>
  </div>
</section>`,
    )
    .join("");

  return `<main style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#22313f">
  <h1 style="font-size:22px;color:#0f2f44">台风监测预警</h1>
  ${rows}
  <p style="font-size:12px;line-height:1.5;color:#607080">由台风监测与预警平台自动生成。影响区域为风险筛查结果，请以当地气象部门正式预警为准。</p>
</main>`;
}

function formatWindow(start: string | null, end: string | null): string {
  if (!start || !end) {
    return "暂无明确影响时间窗";
  }

  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
  return `${formatter.format(new Date(start))} 至 ${formatter.format(new Date(end))}`;
}

function emailProviderName(): string {
  if (process.env.RESEND_API_KEY && process.env.ALERT_FROM) {
    return "Resend";
  }

  if (process.env.EMAIL_WEBHOOK_URL) {
    return "Webhook";
  }

  return "dry-run";
}

function isEmailConfigured(): boolean {
  return Boolean(
    (process.env.RESEND_API_KEY && process.env.ALERT_FROM) ||
      process.env.EMAIL_WEBHOOK_URL,
  );
}

function splitRecipients(value: string): string[] {
  return value
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
