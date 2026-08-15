import type { TyphoonDashboard, TyphoonSystem } from "@/lib/typhoon";
import { TYPHOON_MAP_CONTENT_ID } from "@/lib/typhoon-map";

export interface DailyReport {
  subject: string;
  text: string;
  html: string;
  activeTyphoons: number;
  sourceStatus: TyphoonDashboard["source"]["status"];
  checkedAt: string;
}

export function createDailyReport(dashboard: TyphoonDashboard): DailyReport {
  const checkedAt = formatChinaTime(dashboard.source.fetchedAt);
  const sourceLive = dashboard.source.status === "live";
  const typhoons = sourceLive ? dashboard.typhoons : [];
  const activeTyphoons = typhoons.length;
  const sourceSummary = sourceLive
    ? activeTyphoons > 0
      ? `监测到 ${activeTyphoons} 个活跃热带气旋系统`
      : "官方列表当前未发布活跃热带气旋"
    : "官方路径数据暂时不可用，本次未使用演示样本判断台风生成状态";
  const subject = sourceLive
    ? activeTyphoons > 0
      ? `台风晨报：监测到 ${activeTyphoons} 个活跃系统`
      : "台风晨报：当前未监测到活跃系统"
    : "台风晨报：官方数据暂时不可用";
  const strongestGust = [...dashboard.regionalWinds]
    .filter((item) => item.gustKmh !== null)
    .sort((a, b) => (b.gustKmh ?? 0) - (a.gustKmh ?? 0))[0];
  const systemText = typhoons.length
    ? typhoons.map(formatSystemText).join("\n\n")
    : "暂无活跃台风详情。";
  const windSummary = strongestGust
    ? `${strongestGust.station} ${strongestGust.gustKmh} km/h（${formatChinaTime(strongestGust.observedAt)}）`
    : "暂无可用区域阵风观测";

  const text = [
    "台风监测每日晨报",
    `检查时间：${checkedAt}`,
    `监测结论：${sourceSummary}`,
    `数据源：${dashboard.source.name}（${sourceLive ? "实时" : "暂不可用"}）`,
    `区域最大阵风：${windSummary}`,
    "",
    systemText,
    "",
    "请以国家及当地气象部门发布的正式预警为准。",
  ].join("\n");

  return {
    subject,
    text,
    html: buildHtml({
      checkedAt,
      sourceLive,
      sourceSummary,
      windSummary,
      typhoons,
    }),
    activeTyphoons,
    sourceStatus: dashboard.source.status,
    checkedAt: dashboard.source.fetchedAt,
  };
}

function formatSystemText(typhoon: TyphoonSystem): string {
  const regions = typhoon.impactRegions.slice(0, 6);
  return [
    `${typhoon.name}｜${typhoon.latest.categoryLabel}`,
    `当前位置：${typhoon.latest.latitude.toFixed(1)}°N, ${typhoon.latest.longitude.toFixed(1)}°E`,
    `当前风速：${typhoon.metrics.currentWindKmh} km/h`,
    `120 小时预报峰值：${typhoon.metrics.peakForecastWindKmh} km/h`,
    `移动：${typhoon.metrics.movementBearing} ${typhoon.metrics.movementKmh} km/h`,
    `预计影响区域：${regions.length ? regions.map((region) => `${region.name}（${impactLabel(region.riskLevel)}，${formatChinaTime(region.windowStart)}起）`).join("、") : "暂无已识别重点陆地区域"}`,
  ].join("\n");
}

function buildHtml(input: {
  checkedAt: string;
  sourceLive: boolean;
  sourceSummary: string;
  windSummary: string;
  typhoons: TyphoonSystem[];
}): string {
  const systems = input.typhoons.length
    ? input.typhoons.map(buildSystemHtml).join("")
    : `<div style="padding:20px;border:1px solid #d9e2df;border-radius:8px;background:#f7faf9;color:#425b55">暂无活跃台风详情。</div>`;

  return `<main style="max-width:680px;margin:0 auto;font-family:Arial,'Microsoft YaHei',sans-serif;color:#20332f">
  <div style="padding:22px 24px;background:#173b46;color:#fff;border-radius:8px 8px 0 0">
    <p style="margin:0 0 6px;font-size:12px;opacity:.78">每日 08:00 自动监测</p>
    <h1 style="margin:0;font-size:24px">台风监测晨报</h1>
  </div>
  <div style="padding:22px 24px;border:1px solid #d9e2df;border-top:0">
    <p style="margin:0 0 8px;color:#64756f;font-size:13px">${escapeHtml(input.checkedAt)}</p>
    <p style="margin:0 0 18px;font-size:17px;line-height:1.6;font-weight:700;color:${input.sourceLive ? "#173b46" : "#a3472b"}">${escapeHtml(input.sourceSummary)}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
      <tr><td style="padding:8px 0;color:#64756f">官方路径数据</td><td style="padding:8px 0;text-align:right;font-weight:700">${input.sourceLive ? "正常" : "暂不可用"}</td></tr>
      <tr><td style="padding:8px 0;color:#64756f">区域最大阵风</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.windSummary)}</td></tr>
    </table>
    <div style="margin:0 0 18px;border:1px solid #d9e2df;border-radius:8px;overflow:hidden;background:#daeced">
      <img src="cid:${TYPHOON_MAP_CONTENT_ID}" width="640" alt="活跃台风路径与影响区域地图" style="display:block;width:100%;height:auto;border:0" />
    </div>
    <p style="margin:-8px 0 18px;font-size:12px;color:#64756f"><span style="color:#1a778a">●</span> 已观测路径　<span style="color:#e08b2b">●</span> 预报路径　<span style="color:#c43531">●</span> 当前中心　<span style="color:#6f4897">○</span> 影响区域</p>
    ${systems}
    <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#64756f">本邮件由台风监测与预警平台自动生成。影响区域属于辅助筛查结果，请以国家及当地气象部门发布的正式预警为准。</p>
  </div>
</main>`;
}

function buildSystemHtml(typhoon: TyphoonSystem): string {
  const regions = typhoon.impactRegions.slice(0, 6);
  const regionRows = regions.length
    ? regions
        .map(
          (region) => `<tr>
        <td style="padding:7px 0">${escapeHtml(region.name)}</td>
        <td style="padding:7px 0;text-align:center">${escapeHtml(impactLabel(region.riskLevel))}</td>
        <td style="padding:7px 0;text-align:right">${escapeHtml(formatChinaTime(region.windowStart))}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="padding:9px 0;color:#64756f">暂无已识别重点陆地区域</td></tr>`;

  return `<section style="margin:0 0 18px;border:1px solid #d9e2df;border-radius:8px;overflow:hidden">
    <div style="padding:14px 16px;background:#edf4f2">
      <h2 style="margin:0 0 4px;font-size:19px;color:#173b46">${escapeHtml(typhoon.name)}</h2>
      <p style="margin:0;font-size:13px;color:#64756f">${escapeHtml(typhoon.latest.categoryLabel)} · ${typhoon.latest.latitude.toFixed(1)}°N, ${typhoon.latest.longitude.toFixed(1)}°E</p>
    </div>
    <div style="padding:14px 16px">
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:14px">
        <tr><td style="padding:6px 0;color:#64756f">当前风速</td><td style="padding:6px 0;text-align:right;font-weight:700">${typhoon.metrics.currentWindKmh} km/h</td></tr>
        <tr><td style="padding:6px 0;color:#64756f">120 小时预报峰值</td><td style="padding:6px 0;text-align:right;font-weight:700">${typhoon.metrics.peakForecastWindKmh} km/h</td></tr>
        <tr><td style="padding:6px 0;color:#64756f">移动</td><td style="padding:6px 0;text-align:right;font-weight:700">${escapeHtml(typhoon.metrics.movementBearing)} ${typhoon.metrics.movementKmh} km/h</td></tr>
      </table>
      <h3 style="margin:0 0 6px;font-size:14px">预计影响区域</h3>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="color:#64756f"><th style="padding:6px 0;text-align:left">区域</th><th style="padding:6px 0;text-align:center">风险</th><th style="padding:6px 0;text-align:right">影响窗口起始</th></tr>
        ${regionRows}
      </table>
    </div>
  </section>`;
}

function formatChinaTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function impactLabel(level: "watch" | "elevated" | "high" | "severe"): string {
  return { watch: "关注", elevated: "较高", high: "高", severe: "严重" }[
    level
  ];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
