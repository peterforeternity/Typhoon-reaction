import { getTyphoonDashboard } from "@/lib/typhoon";

export const runtime = "edge";

export async function GET() {
  const dashboard = await getTyphoonDashboard();

  return Response.json(dashboard, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
