"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";
import type {
  AlertRules,
  ImpactRegion,
  TyphoonDashboard,
  TyphoonPoint,
  TyphoonSystem,
  WindForecastPoint,
} from "@/lib/typhoon";

type LoadState = "loading" | "ready" | "error";

interface AlertFormState {
  recipients: string;
  minWindEnabled: boolean;
  minWindKmh: number;
  categoryEnabled: boolean;
  categoryRank: number;
  proximityEnabled: boolean;
  watchLatitude: number;
  watchLongitude: number;
  radiusKm: number;
  rapidIntensityEnabled: boolean;
  trendKmh: number;
  autoSend: boolean;
}

interface AlertResponse {
  status: "clear" | "dry_run" | "sent" | "failed" | "skipped";
  message: string;
  provider?: string;
  matches: Array<{
    typhoonName: string;
    reasons: string[];
    currentWindKmh: number;
    distanceKm: number | null;
    warningLevel?: string;
    impactRegions?: string[];
  }>;
}

const categoryOptions = [
  { label: "热带低压", value: 1 },
  { label: "热带风暴", value: 2 },
  { label: "强热带风暴", value: 3 },
  { label: "台风", value: 4 },
  { label: "强台风", value: 5 },
  { label: "超强台风", value: 6 },
];

const initialRules: AlertFormState = {
  recipients: "",
  minWindEnabled: true,
  minWindKmh: 63,
  categoryEnabled: true,
  categoryRank: 2,
  proximityEnabled: true,
  watchLatitude: 22.3,
  watchLongitude: 114.2,
  radiusKm: 600,
  rapidIntensityEnabled: true,
  trendKmh: 20,
  autoSend: false,
};

export default function Home() {
  const [dashboard, setDashboard] = useState<TyphoonDashboard | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [rules, setRules] = useState<AlertFormState>(initialRules);
  const [alertStatus, setAlertStatus] = useState<AlertResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const selectedTyphoon = useMemo(() => {
    if (!dashboard?.typhoons.length) return null;
    return (
      dashboard.typhoons.find((typhoon) => typhoon.id === selectedId) ??
      dashboard.typhoons[0]
    );
  }, [dashboard, selectedId]);

  const loadTyphoons = useCallback(async () => {
    try {
      const response = await fetch("/api/typhoons", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as TyphoonDashboard;
      setDashboard(data);
      setSelectedId((current) => current || data.typhoons[0]?.id || "");
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  const runAlertCheck = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false, rules: toAlertRules(rules) }),
      });
      setAlertStatus((await response.json()) as AlertResponse);
    } catch {
      setAlertStatus({
        status: "failed",
        message: "预警校验请求失败",
        matches: [],
      });
    } finally {
      setChecking(false);
    }
  }, [rules]);

  useEffect(() => {
    const initialTimer = window.setTimeout(loadTyphoons, 0);
    const refreshTimer = window.setInterval(loadTyphoons, 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
    };
  }, [loadTyphoons]);

  useEffect(() => {
    if (!rules.autoSend || !dashboard || rules.recipients.trim() === "") return;
    const signature = dashboard.typhoons
      .map((typhoon) => `${typhoon.id}:${typhoon.latest.time}`)
      .join("|");
    const alertKey = `typhoon-alert:${signature}:${rules.minWindKmh}:${rules.radiusKm}`;
    if (window.localStorage.getItem(alertKey)) return;
    window.localStorage.setItem(alertKey, new Date().toISOString());
    const timer = window.setTimeout(runAlertCheck, 0);
    return () => window.clearTimeout(timer);
  }, [dashboard, rules.autoSend, rules.minWindKmh, rules.radiusKm, rules.recipients, runAlertCheck]);

  return (
    <main className="app-shell">
      <section className="command-surface" aria-label="台风监测总览">
        <header className="topbar">
          <div>
            <p className="eyebrow">TROPICAL CYCLONE OPERATIONS</p>
            <h1>台风监测与预警平台</h1>
            <p className="topbar-copy">官方路径、区域实况、影响筛查与 120 小时强度预测</p>
          </div>
          <div className="topbar-actions">
            <span className={`source-pill ${dashboard?.source.status ?? "live"}`}>
              <i />{dashboard?.source.status === "fallback" ? "演示数据" : "数据在线"}
            </span>
            <button className="icon-button" type="button" onClick={loadTyphoons} aria-label="刷新监测数据">
              ↻ <span>刷新</span>
            </button>
          </div>
        </header>

        <div className="status-strip">
          <Metric label="监测状态" value={statusLabel(state, dashboard)} tone="status" />
          <Metric label="活跃系统" value={`${dashboard?.typhoons.length ?? 0}`} suffix="个" />
          <Metric label="预报范围" value="120" suffix="小时" />
          <Metric label="数据刷新" value={formatTime(dashboard?.source.fetchedAt)} compact />
          <Metric label="在线数据源" value={`${dashboard?.sources.filter((source) => source.status === "live").length ?? 0}`} suffix="路" />
        </div>

        {state === "error" ? (
          <EmptyState title="实时数据暂不可用" copy="系统会继续自动重试，预警规则不会丢失。" />
        ) : dashboard?.typhoons.length === 0 ? (
          <EmptyState title="当前未监测到活跃台风" copy={dashboard.source.message} />
        ) : selectedTyphoon ? (
          <>
            <div className="primary-grid">
              <section className="panel map-panel" aria-label="台风路径与影响区域">
                <PanelHeader eyebrow="路径与影响预测" title={selectedTyphoon.name}>
                  <select aria-label="选择台风" value={selectedTyphoon.id} onChange={(event) => setSelectedId(event.target.value)}>
                    {dashboard.typhoons.map((typhoon) => <option key={typhoon.id} value={typhoon.id}>{typhoon.name}</option>)}
                  </select>
                </PanelHeader>
                <TrackImpactMap
                  typhoon={selectedTyphoon}
                  selectedRegionId={selectedRegionId}
                  onSelectRegion={setSelectedRegionId}
                />
              </section>

              <section className="panel situation-panel" aria-label="态势研判">
                <PanelHeader eyebrow="态势研判" title={selectedTyphoon.latest.categoryLabel}>
                  <span className={`risk-badge ${selectedTyphoon.metrics.riskLevel}`}>{riskLabel(selectedTyphoon.metrics.riskLevel)}</span>
                </PanelHeader>
                <div className="situation-main">
                  <span>当前近中心风速</span>
                  <strong>{selectedTyphoon.metrics.currentWindKmh}<small> km/h</small></strong>
                  <p>{trendSentence(selectedTyphoon)}</p>
                </div>
                <div className="mini-metrics">
                  <Metric label="预报峰值" value={`${selectedTyphoon.metrics.peakForecastWindKmh}`} suffix="km/h" />
                  <Metric label="移速与方向" value={`${selectedTyphoon.metrics.movementKmh}`} suffix={`km/h ${selectedTyphoon.metrics.movementBearing}`} />
                  <Metric label="受影响区域" value={`${selectedTyphoon.impactRegions.length}`} suffix="处" />
                </div>
                <ImpactList regions={selectedTyphoon.impactRegions.slice(0, 5)} selectedId={selectedRegionId} onSelect={setSelectedRegionId} />
              </section>
            </div>

            <div className="secondary-grid">
              <section className="panel forecast-panel" aria-label="风速时间预测">
                <PanelHeader eyebrow="时间预测" title="风速变化曲线">
                  <div className="forecast-legend"><span className="observed-key">实况</span><span className="forecast-key">官方预报</span><span className="band-key">筛查区间</span></div>
                </PanelHeader>
                <ForecastChart points={selectedTyphoon.points} forecast={selectedTyphoon.windForecast} />
              </section>

              <section className="panel observations-panel" aria-label="区域风场实况">
                <PanelHeader eyebrow="十分钟实况" title="区域风场" />
                <RegionalWindList dashboard={dashboard} />
              </section>

              <section className="panel source-panel" aria-label="数据源状态">
                <PanelHeader eyebrow="采集链路" title="数据源状态" />
                <div className="source-list">
                  {dashboard.sources.map((source) => (
                    <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                      <i className={source.status} />
                      <span><strong>{source.name}</strong><small>{source.role}</small></span>
                      <em>{source.cadence}</em>
                    </a>
                  ))}
                </div>
              </section>
            </div>

            <section className="panel alert-panel" aria-label="邮件预警配置">
              <PanelHeader eyebrow="自动预警" title="邮件推送规则">
                <label className="switch"><input type="checkbox" checked={rules.autoSend} onChange={(event) => setRules((current) => ({ ...current, autoSend: event.target.checked }))} /><span>{rules.autoSend ? "自动监测" : "手动校验"}</span></label>
              </PanelHeader>
              <div className="alert-layout">
                <div className="recipient-column">
                  <label className="field"><span>收件邮箱</span><input type="email" placeholder="使用环境变量默认邮箱，或在此填写" value={rules.recipients} onChange={(event) => setRules((current) => ({ ...current, recipients: event.target.value }))} /></label>
                  <div className="alert-explainer">
                    <strong>邮件将包含</strong>
                    <span>预警级别 · 预计影响时段 · 影响区域 · 中心风速 · 防御建议</span>
                  </div>
                  <button className="primary-button" type="button" disabled={checking} onClick={runAlertCheck}>{checking ? "正在研判" : "校验条件并发送"}</button>
                  {alertStatus ? <AlertResult result={alertStatus} /> : null}
                </div>
                <div className="rule-grid">
                  <RuleToggle label="风速阈值" checked={rules.minWindEnabled} onChecked={(checked) => setRules((current) => ({ ...current, minWindEnabled: checked }))}>
                    <input aria-label="风速阈值" type="range" min="41" max="185" step="1" value={rules.minWindKmh} onChange={(event) => setRules((current) => ({ ...current, minWindKmh: Number(event.target.value) }))} />
                    <strong>{rules.minWindKmh} km/h</strong><small>默认 63 km/h，热带风暴级</small>
                  </RuleToggle>
                  <RuleToggle label="等级阈值" checked={rules.categoryEnabled} onChecked={(checked) => setRules((current) => ({ ...current, categoryEnabled: checked }))}>
                    <select value={rules.categoryRank} onChange={(event) => setRules((current) => ({ ...current, categoryRank: Number(event.target.value) }))}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                  </RuleToggle>
                  <RuleToggle label="关注范围" checked={rules.proximityEnabled} onChecked={(checked) => setRules((current) => ({ ...current, proximityEnabled: checked }))}>
                    <div className="coordinate-row"><input aria-label="关注点纬度" type="number" step="0.1" value={rules.watchLatitude} onChange={(event) => setRules((current) => ({ ...current, watchLatitude: Number(event.target.value) }))} /><input aria-label="关注点经度" type="number" step="0.1" value={rules.watchLongitude} onChange={(event) => setRules((current) => ({ ...current, watchLongitude: Number(event.target.value) }))} /></div>
                    <input aria-label="关注半径" type="range" min="100" max="1200" step="25" value={rules.radiusKm} onChange={(event) => setRules((current) => ({ ...current, radiusKm: Number(event.target.value) }))} />
                    <strong>{rules.radiusKm} km</strong>
                  </RuleToggle>
                  <RuleToggle label="快速增强" checked={rules.rapidIntensityEnabled} onChecked={(checked) => setRules((current) => ({ ...current, rapidIntensityEnabled: checked }))}>
                    <input aria-label="快速增强阈值" type="number" min="5" max="80" value={rules.trendKmh} onChange={(event) => setRules((current) => ({ ...current, trendKmh: Number(event.target.value) }))} />
                    <strong>{rules.trendKmh} km/h</strong>
                  </RuleToggle>
                </div>
              </div>
            </section>

            <p className="method-note">影响区域为基于中心风速筛查半径与官方路径误差半径的风险研判，不替代当地气象部门正式预警。短期为 0–24 小时，中期为 24–120 小时。</p>
          </>
        ) : (
          <EmptyState title="正在连接实时数据" copy="监测台会在数据返回后自动更新。" />
        )}
      </section>
    </main>
  );
}

function TrackImpactMap({ typhoon, selectedRegionId, onSelectRegion }: { typhoon: TyphoonSystem; selectedRegionId: string; onSelectRegion: (id: string) => void }) {
  const projection = useMemo(() => geoMercator().center([125, 20]).scale(570).translate([500, 280]), []);
  const landPath = useMemo(() => {
    const topology = worldAtlas as unknown as Topology<{ countries: GeometryCollection }>;
    return geoPath(projection)(feature(topology, topology.objects.countries)) ?? "";
  }, [projection]);
  const project = (longitude: number, latitude: number) => projection([longitude, latitude]) ?? [0, 0];
  const observed = typhoon.points.filter((point) => point.kind !== "forecast");
  const forecast = typhoon.points.filter((point) => point.kind === "forecast");
  const pathFor = (points: TyphoonPoint[]) => points.map((point, index) => { const [x, y] = project(point.longitude, point.latitude); return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");

  return (
    <div className="track-map">
      <svg viewBox="0 0 1000 560" role="img" aria-label={`${typhoon.name} 官方路径与预计影响区域地图`}>
        <title>{typhoon.name} 官方路径与预计影响区域</title>
        <rect width="1000" height="560" className="ocean" />
        <path d={landPath} className="land" />
        {[110, 120, 130, 140].map((longitude) => { const [x] = project(longitude, 5); return <g key={longitude}><line x1={x} x2={x} y1="0" y2="560" className="grid-line" /><text x={x + 5} y="542" className="geo-label">{longitude}°E</text></g>; })}
        {[10, 20, 30].map((latitude) => { const [, y] = project(100, latitude); return <g key={latitude}><line x1="0" x2="1000" y1={y} y2={y} className="grid-line" /><text x="12" y={y - 7} className="geo-label">{latitude}°N</text></g>; })}
        {forecast.map((point, index) => { const [x, y] = project(point.longitude, point.latitude); const horizon = typhoon.windForecast[index + 1]?.horizonHours ?? (index + 1) * 24; const radius = Math.min(78, 18 + horizon * 0.42); return <circle key={`uncertainty-${point.id}`} cx={x} cy={y} r={radius} className="uncertainty-ring" />; })}
        <path d={pathFor(observed)} className="track-observed" />
        <path d={pathFor([typhoon.latest, ...forecast])} className="track-forecast" />
        {typhoon.impactRegions.map((region) => { const [x, y] = project(region.longitude, region.latitude); return <g key={region.id} className={`impact-marker ${region.riskLevel} ${selectedRegionId === region.id ? "selected" : ""}`} onClick={() => onSelectRegion(region.id)}><circle cx={x} cy={y} r={selectedRegionId === region.id ? 11 : 8} /><text x={x + 12} y={y + 4}>{region.name}</text><title>{region.name}：{impactRiskLabel(region.riskLevel)}风险，预计 {formatForecastTime(region.eta)}</title></g>; })}
        {typhoon.points.map((point) => { const [x, y] = project(point.longitude, point.latitude); return <g key={point.id}><circle cx={x} cy={y} r={point.kind === "analysis" ? 7 : 4.5} className={`track-point ${point.kind}`}><title>{formatForecastTime(point.timestamp ?? point.time)}，{point.maxWindKmh} km/h</title></circle></g>; })}
      </svg>
      <div className="map-legend"><span><i className="past-dot" />实况路径</span><span><i className="forecast-dot" />官方预报</span><span><i className="impact-dot" />预计影响区域</span><span><i className="uncertainty-dot" />路径不确定范围</span><em>{typhoon.latest.latitude.toFixed(1)}°N · {typhoon.latest.longitude.toFixed(1)}°E</em></div>
    </div>
  );
}

function ForecastChart({ points, forecast }: { points: TyphoonPoint[]; forecast: WindForecastPoint[] }) {
  const observed = points.filter((point) => point.kind !== "forecast" && point.timestamp).slice(-7);
  const currentTime = forecast[0]?.timestamp
    ? new Date(forecast[0].timestamp).getTime()
    : new Date(observed.at(-1)?.timestamp ?? 0).getTime();
  const history = observed.map((point) => ({ timestamp: point.timestamp ?? point.time, horizonHours: Math.round((new Date(point.timestamp ?? point.time).getTime() - currentTime) / 3_600_000), windKmh: point.maxWindKmh }));
  const allHours = [...history.map((point) => point.horizonHours), ...forecast.map((point) => point.horizonHours)];
  const minHour = Math.min(-36, ...allHours);
  const maxHour = Math.max(120, ...allHours);
  const maxWind = Math.max(200, ...history.map((point) => point.windKmh), ...forecast.map((point) => point.upperKmh));
  const x = (hour: number) => 58 + ((hour - minHour) / (maxHour - minHour)) * 864;
  const y = (wind: number) => 296 - (wind / maxWind) * 250;
  const line = (series: Array<{ horizonHours: number; windKmh: number }>) => series.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.horizonHours).toFixed(1)},${y(point.windKmh).toFixed(1)}`).join(" ");
  const band = forecast.length > 1 ? `${forecast.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.horizonHours).toFixed(1)},${y(point.upperKmh).toFixed(1)}`).join(" ")} ${[...forecast].reverse().map((point) => `L${x(point.horizonHours).toFixed(1)},${y(point.lowerKmh).toFixed(1)}`).join(" ")} Z` : "";

  return (
    <div className="forecast-chart">
      <svg viewBox="0 0 960 340" role="img" aria-label="台风近中心最大风速实况与未来 120 小时预测曲线">
        <title>近中心最大风速实况及 120 小时预测</title>
        {[0, 63, 88, 118, 150, 185].map((wind) => <g key={wind}><line x1="58" x2="922" y1={y(wind)} y2={y(wind)} className="chart-grid" /><text x="48" y={y(wind) + 4} textAnchor="end" className="chart-label">{wind}</text></g>)}
        {[-24, 0, 24, 48, 72, 96, 120].map((hour) => <g key={hour}><line x1={x(hour)} x2={x(hour)} y1="46" y2="296" className={hour === 0 || hour === 24 ? "chart-boundary" : "chart-grid"} /><text x={x(hour)} y="320" textAnchor="middle" className="chart-label">{hour === 0 ? "当前" : `${hour > 0 ? "+" : ""}${hour}h`}</text></g>)}
        <text x={(x(0) + x(24)) / 2} y="27" textAnchor="middle" className="period-label">短期 0–24h</text>
        <text x={(x(24) + x(120)) / 2} y="27" textAnchor="middle" className="period-label">中期 24–120h</text>
        {band ? <path d={band} className="forecast-band" /> : null}
        <path d={line(history)} className="chart-observed" />
        <path d={line(forecast)} className="chart-forecast" />
        {forecast.map((point) => <g key={point.timestamp}><circle cx={x(point.horizonHours)} cy={y(point.windKmh)} r="5" className="forecast-point"><title>{formatForecastTime(point.timestamp)}：{point.windKmh} km/h，筛查区间 {point.lowerKmh}–{point.upperKmh} km/h</title></circle>{point.horizonHours === 24 || point.horizonHours === 72 || point.horizonHours === 120 ? <text x={x(point.horizonHours)} y={y(point.windKmh) - 12} textAnchor="middle" className="value-label">{point.windKmh}</text> : null}</g>)}
      </svg>
      <div className="chart-axis-caption">近中心最大持续风速（km/h） · 阴影为随预报时效扩大的筛查区间</div>
    </div>
  );
}

function ImpactList({ regions, selectedId, onSelect }: { regions: ImpactRegion[]; selectedId: string; onSelect: (id: string) => void }) {
  if (!regions.length) return <div className="no-impact">当前官方路径筛查范围内暂未识别重点陆地区域</div>;
  return <div className="impact-list">{regions.map((region) => <button key={region.id} type="button" className={selectedId === region.id ? "selected" : ""} onClick={() => onSelect(region.id)}><i className={region.riskLevel} /><span><strong>{region.name}</strong><small>{formatImpactWindow(region)} · {region.confidence}置信度</small></span><em>{impactRiskLabel(region.riskLevel)}</em></button>)}</div>;
}

function RegionalWindList({ dashboard }: { dashboard: TyphoonDashboard }) {
  const stations = [...dashboard.regionalWinds].filter((item) => item.gustKmh !== null).sort((a, b) => (b.gustKmh ?? 0) - (a.gustKmh ?? 0)).slice(0, 6);
  const max = Math.max(1, ...stations.map((station) => station.gustKmh ?? 0));
  if (!stations.length) return <div className="no-impact">区域风场暂未返回有效观测</div>;
  return <div className="wind-list">{stations.map((station) => <div key={station.station}><span><strong>{station.station}</strong><small>{station.direction}</small></span><div><i style={{ width: `${((station.gustKmh ?? 0) / max) * 100}%` }} /></div><em>{station.gustKmh} <small>km/h 阵风</small></em></div>)}</div>;
}

function AlertResult({ result }: { result: AlertResponse }) {
  return <div className={`alert-result ${result.status}`}><strong>{result.message}</strong>{result.matches.map((match) => <p key={match.typhoonName}>{match.warningLevel ? `${match.warningLevel} · ` : ""}{match.typhoonName}：{match.reasons[0]}</p>)}</div>;
}

function PanelHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return <div className="panel-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{children ? <div className="panel-actions">{children}</div> : null}</div>;
}

function Metric({ label, value, suffix, compact, tone }: { label: string; value: string; suffix?: string; compact?: boolean; tone?: string }) {
  return <div className={`metric ${compact ? "compact" : ""} ${tone ?? ""}`}><span>{label}</span><strong>{value}{suffix ? <small>{suffix}</small> : null}</strong></div>;
}

function RuleToggle({ label, checked, onChecked, children }: { label: string; checked: boolean; onChecked: (checked: boolean) => void; children: React.ReactNode }) {
  return <div className={`rule-block ${checked ? "enabled" : ""}`}><label className="rule-heading"><input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} /><span>{label}</span></label><div className="rule-control">{children}</div></div>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><h2>{title}</h2><p>{copy}</p></div>;
}

function toAlertRules(rules: AlertFormState): AlertRules {
  return {
    recipients: rules.recipients.split(/[,\s;]+/).map((recipient) => recipient.trim()).filter(Boolean),
    minWindEnabled: rules.minWindEnabled,
    minWindKmh: rules.minWindKmh,
    categoryEnabled: rules.categoryEnabled,
    categoryRank: rules.categoryRank,
    proximityEnabled: rules.proximityEnabled,
    watchLatitude: rules.watchLatitude,
    watchLongitude: rules.watchLongitude,
    radiusKm: rules.radiusKm,
    rapidIntensityEnabled: rules.rapidIntensityEnabled,
    trendKmh: rules.trendKmh,
  };
}

function statusLabel(state: LoadState, dashboard: TyphoonDashboard | null) {
  if (state === "loading") return "连接中";
  if (state === "error") return "异常";
  if (!dashboard) return "待确认";
  return dashboard.typhoons.length ? "持续监测" : "未生成";
}

function formatTime(value: string | undefined) {
  if (!value) return "等待中";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatForecastTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatImpactWindow(region: ImpactRegion) {
  return `${formatForecastTime(region.windowStart)}–${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(region.windowEnd))}`;
}

function riskLabel(level: TyphoonSystem["metrics"]["riskLevel"]) {
  return { low: "蓝色关注", moderate: "黄色预警", high: "橙色预警", extreme: "红色预警" }[level];
}

function impactRiskLabel(level: ImpactRegion["riskLevel"]) {
  return { watch: "关注", elevated: "较高", high: "高风险", severe: "严重" }[level];
}

function trendSentence(typhoon: TyphoonSystem) {
  const trend = typhoon.metrics.windTrendKmh;
  if (trend > 0) return `近期增强 ${trend} km/h，未来峰值预计 ${typhoon.metrics.peakForecastWindKmh} km/h。`;
  if (trend < 0) return `近期减弱 ${Math.abs(trend)} km/h，仍需关注路径变化。`;
  return `强度整体平稳，未来峰值预计 ${typhoon.metrics.peakForecastWindKmh} km/h。`;
}
