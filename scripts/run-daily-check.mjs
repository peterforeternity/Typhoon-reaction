const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const secret = process.env.CRON_SECRET;

if (!baseUrl) {
  console.error("Missing APP_BASE_URL (for example https://your-service.onrender.com)");
  process.exit(1);
}

if (!secret) {
  console.error("Missing CRON_SECRET");
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 90_000);

try {
  const response = await fetch(`${baseUrl}/api/cron/daily`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: "{}",
    signal: controller.signal,
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Daily check returned ${response.status}: ${body}`);
  }

  console.log(body);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
