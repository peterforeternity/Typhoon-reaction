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
    minWindKmh: numberOr(raw?.minWindKmh, 118),
    categoryEnabled: raw?.categoryEnabled ?? true,
    categoryRank: numberOr(raw?.categoryRank, 4),
    proximityEnabled: raw?.proximityEnabled ?? true,
    watchLatitude: numberOr(raw?.watchLatitude, 22.3),
    watchLongitude: numberOr(raw?.watchLongitude, 114.2),
    radiusKm: numberOr(raw?.radiusKm, 450),
    rapidIntensityEnabled: raw?.rapidIntensityEnabled ?? true,
    trendKmh: numberOr(raw?.trendKmh, 25),
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
        `${match.typhoonName}\n风速：${match.currentWindKmh} km/h\n距离：${
          match.distanceKm ?? "未计算"
        } km\n${match.reasons.join("\n")}`,
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
      (match) => `<section style="margin:0 0 18px;padding:16px;border:1px solid #d9e2ec;border-radius:8px">
  <h2 style="margin:0 0 10px;font-size:18px;color:#0f2f44">${escapeHtml(match.typhoonName)}</h2>
  <p style="margin:0 0 8px">当前风速：<strong>${match.currentWindKmh} km/h</strong></p>
  <p style="margin:0 0 8px">距关注点：<strong>${match.distanceKm ?? "未计算"} km</strong></p>
  <ul style="margin:8px 0 0;padding-left:20px">${match.reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("")}</ul>
</section>`,
    )
    .join("");

  return `<main style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#22313f">
  <h1 style="font-size:22px;color:#0f2f44">台风监测预警</h1>
  ${rows}
  <p style="font-size:12px;color:#607080">由台风监测与预警平台自动生成。</p>
</main>`;
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
