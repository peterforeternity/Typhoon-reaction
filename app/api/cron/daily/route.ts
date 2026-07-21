import { createDailyReport } from "@/lib/daily-report";
import { getTyphoonDashboard } from "@/lib/typhoon";

export const runtime = "edge";

interface DailyRequest {
  dryRun?: boolean;
}

export async function GET() {
  return Response.json({
    service: "daily-typhoon-report",
    configured: Boolean(process.env.CRON_SECRET),
    schedule: "每天 08:00 Asia/Shanghai（Render Cron: 0 0 * * * UTC）",
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DailyRequest;
  const recipients = splitRecipients(process.env.ALERT_TO ?? "");
  if (recipients.length === 0) {
    return Response.json(
      { status: "failed", message: "未配置 ALERT_TO 收件邮箱" },
      { status: 503 },
    );
  }

  const dashboard = await getTyphoonDashboard();
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
    const provider = await sendEmail({
      recipients,
      subject: report.subject,
      text: report.text,
      html: report.html,
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
