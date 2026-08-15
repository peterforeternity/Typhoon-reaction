import { createDailyReport } from "@/lib/daily-report";
import { getTyphoonDashboard } from "@/lib/typhoon";
import { createTyphoonMapAttachment } from "@/lib/typhoon-map";

export const runtime = "edge";

interface DailyRequest {
  dryRun?: boolean;
}

export async function GET() {
  return Response.json({
    service: "daily-typhoon-report",
    configured: Boolean(process.env.CRON_SECRET),
    schedule: "每天 08:00 Asia/Shanghai（GitHub Actions）",
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DailyRequest;
  const dashboard = await getTyphoonDashboard();

  if (dashboard.source.status !== "live") {
    return Response.json({
      status: "skipped",
      reason: "source_unavailable",
      message: "官方台风数据暂时不可用，本次停止推送",
      checkedAt: dashboard.source.fetchedAt,
    });
  }

  if (dashboard.typhoons.length === 0) {
    return Response.json({
      status: "skipped",
      reason: "no_active_typhoons",
      message: "当前没有活跃台风，本次停止推送",
      checkedAt: dashboard.source.fetchedAt,
    });
  }

  const recipients = splitRecipients(process.env.ALERT_TO ?? "");
  if (recipients.length === 0) {
    return Response.json(
      { status: "failed", message: "未配置 ALERT_TO 收件邮箱" },
      { status: 503 },
    );
  }

  const report = createDailyReport(dashboard);

  if (body.dryRun === true) {
    return Response.json({
      status: "dry_run",
      subject: report.subject,
      activeTyphoons: report.activeTyphoons,
      sourceStatus: report.sourceStatus,
      checkedAt: report.checkedAt,
    });
  }

  try {
    const mapAttachment = await createTyphoonMapAttachment(
      dashboard.typhoons,
    );
    const provider = await sendEmail({
      recipients,
      subject: report.subject,
      text: report.text,
      html: report.html,
      attachments: [mapAttachment],
    });

    return Response.json({
      status: "sent",
      provider,
      activeTyphoons: report.activeTyphoons,
      sourceStatus: report.sourceStatus,
      checkedAt: report.checkedAt,
      recipientCount: recipients.length,
    });
  } catch (error) {
    return Response.json(
      {
        status: "failed",
        message: error instanceof Error ? error.message : "晨报邮件发送失败",
        activeTyphoons: report.activeTyphoons,
        sourceStatus: report.sourceStatus,
      },
      { status: 502 },
    );
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function sendEmail(input: {
  recipients: string[];
  subject: string;
  text: string;
  html: string;
  attachments: Array<{
    content: string;
    filename: string;
    content_id: string;
  }>;
}): Promise<"Resend" | "Webhook"> {
  if (process.env.RESEND_API_KEY && process.env.ALERT_FROM) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ALERT_FROM,
        to: input.recipients,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
    }
    return "Resend";
  }

  if (process.env.EMAIL_WEBHOOK_URL) {
    const response = await fetch(process.env.EMAIL_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Email webhook returned ${response.status}`);
    }
    return "Webhook";
  }

  throw new Error("未配置 RESEND_API_KEY/ALERT_FROM 或 EMAIL_WEBHOOK_URL");
}

function splitRecipients(value: string): string[] {
  return value
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
