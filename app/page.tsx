"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AlertRules,
  TyphoonDashboard,
  TyphoonPoint,
  TyphoonSystem,
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
  minWindKmh: 118,
  categoryEnabled: true,
  categoryRank: 4,
  proximityEnabled: true,
  watchLatitude: 22.3,
  watchLongitude: 114.2,
  radiusKm: 450,
  rapidIntensityEnabled: true,
  trendKmh: 25,
  autoSend: false,
};

export default function Home() {
  const [dashboard, setDashboard] = useState<TyphoonDashboard | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [state, setState] = useState<LoadState>("loading");
  const [rules, setRules] = useState<AlertFormState>(initialRules);
  const [alertStatus, setAlertStatus] = useState<AlertResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const selectedTyphoon = useMemo(() => {
    if (!dashboard?.typhoons.length) {
      return null;
    }

    return (
      dashboard.typhoons.find((typhoon) => typhoon.id === selectedId) ??
      dashboard.typhoons[0]
    );
  }, [dashboard, selectedId]);

  const loadTyphoons = useCallback(async () => {
    try {
      const response = await fetch("/api/typhoons", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as TyphoonDashboard;
      setDashboard(data);
      setSelectedId((current) => current || data.typhoons[0]?.id || "");
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  const runAlertCheck = useCallback(
    async (dryRun = false) => {
      setChecking(true);

      try {
        const response = await fetch("/api/alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dryRun,
            rules: toAlertRules(rules),
          }),
        });
        const payload = (await response.json()) as AlertResponse;
        setAlertStatus(payload);
      } catch {
        setAlertStatus({
          status: "failed",
          message: "预警校验请求失败",
          matches: [],
        });
      } finally {
        setChecking(false);
      }
    },
    [rules],
  );

  useEffect(() => {
    const initialTimer = window.setTimeout(loadTyphoons, 0);
    const timer = window.setInterval(loadTyphoons, 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadTyphoons]);

  useEffect(() => {
    if (!rules.autoSend || !dashboard || rules.recipients.trim() === "") {
      return;
    }

    const latestSignature = dashboard.typhoons
      .map((typhoon) => `${typhoon.id}:${typhoon.latest.time}`)
      .join("|");
    const alertKey = `typhoon-alert:${latestSignature}:${rules.minWindKmh}:${rules.radiusKm}`;

    if (window.localStorage.getItem(alertKey)) {
      return;
    }

    window.localStorage.setItem(alertKey, new Date().toISOString());
    const alertTimer = window.setTimeout(() => runAlertCheck(false), 0);
    return () => window.clearTimeout(alertTimer);
  }, [
    dashboard,
    rules.autoSend,
    rules.minWindKmh,
    rules.radiusKm,
    rules.recipients,
    runAlertCheck,
  ]);

  return (
    <main className="app-shell">
      <section className="command-surface" aria-label="台风监测总览">
        <div className="topbar">
          <div>
            <p className="eyebrow">实时气象业务台</p>
            <h1>台风监测与预警平台</h1>
          </div>
          <div className="topbar-actions">
            <span className={`source-pill ${dashboard?.source.status ?? "live"}`}>
              {dashboard?.source.status === "fallback" ? "演示兜底" : "官方实时"}
            </span>
            <button className="icon-button" type="button" onClick={loadTyphoons}>
              刷新
            </button>
          </div>
        </div>

        <div className="status-strip">
          <Metric label="生成状态" value={statusLabel(state, dashboard)} />
          <Metric
            label="活跃系统"
            value={`${dashboard?.typhoons.length ?? 0}`}
            suffix="个"
          />
          <Metric
            label="更新时间"
            value={formatTime(dashboard?.source.fetchedAt)}
          />
          <Metric
            label="数据源"
            value={dashboard?.source.name ?? "连接中"}
            compact
          />
        </div>

        {state === "error" ? (
          <div className="empty-state">
            <h2>实时数据暂不可用</h2>
            <p>稍后会继续自动重试，预警规则配置不会丢失。</p>
          </div>
        ) : dashboard?.typhoons.length === 0 ? (
          <div className="empty-state">
            <h2>当前未监测到活跃台风</h2>
            <p>{dashboard.source.message}</p>
          </div>
        ) : selectedTyphoon ? (
          <div className="dashboard-grid">
            <section className="map-panel" aria-label="台风路径">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">路径追踪</p>
                  <h2>{selectedTyphoon.name}</h2>
                </div>
                <select
                  aria-label="选择台风"
                  value={selectedTyphoon.id}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {dashboard.typhoons.map((typhoon) => (
                    <option key={typhoon.id} value={typhoon.id}>
                      {typhoon.name}
                    </option>
                  ))}
                </select>
              </div>
              <TrackMap typhoon={selectedTyphoon} />
            </section>

            <section className="analysis-panel" aria-label="强度分析">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">强度变化</p>
                  <h2>{selectedTyphoon.latest.categoryLabel}</h2>
                </div>
                <span className={`risk-badge ${selectedTyphoon.metrics.riskLevel}`}>
                  {riskLabel(selectedTyphoon.metrics.riskLevel)}
                </span>
              </div>
              <div className="analysis-cards">
                <Metric
                  label="当前风速"
                  value={`${selectedTyphoon.metrics.currentWindKmh}`}
                  suffix="km/h"
                />
                <Metric
                  label="预报峰值"
                  value={`${selectedTyphoon.metrics.peakForecastWindKmh}`}
                  suffix="km/h"
                />
                <Metric
                  label="近期增强"
                  value={`${selectedTyphoon.metrics.windTrendKmh}`}
                  suffix="km/h"
                />
                <Metric
                  label="移动"
                  value={`${selectedTyphoon.metrics.movementKmh}`}
                  suffix={`km/h ${selectedTyphoon.metrics.movementBearing}`}
                />
              </div>
              <IntensityChart points={selectedTyphoon.points} />
            </section>

            <section className="alert-panel" aria-label="邮件预警配置">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">自动预警</p>
                  <h2>邮件推送</h2>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={rules.autoSend}
                    onChange={(event) =>
                      setRules((current) => ({
                        ...current,
                        autoSend: event.target.checked,
                      }))
                    }
                  />
                  <span>{rules.autoSend ? "自动" : "手动"}</span>
                </label>
              </div>

              <label className="field">
                <span>收件邮箱</span>
                <input
                  type="email"
                  placeholder="ops@example.com"
                  value={rules.recipients}
                  onChange={(event) =>
                    setRules((current) => ({
                      ...current,
                      recipients: event.target.value,
                    }))
                  }
                />
              </label>

              <RuleToggle
                label="风速阈值"
                checked={rules.minWindEnabled}
                onChecked={(checked) =>
                  setRules((current) => ({ ...current, minWindEnabled: checked }))
                }
              >
                <input
                  type="range"
                  min="40"
                  max="220"
                  value={rules.minWindKmh}
                  onChange={(event) =>
                    setRules((current) => ({
                      ...current,
                      minWindKmh: Number(event.target.value),
                    }))
                  }
                />
                <strong>{rules.minWindKmh} km/h</strong>
              </RuleToggle>

              <RuleToggle
                label="等级阈值"
                checked={rules.categoryEnabled}
                onChecked={(checked) =>
                  setRules((current) => ({ ...current, categoryEnabled: checked }))
                }
              >
                <select
                  value={rules.categoryRank}
                  onChange={(event) =>
                    setRules((current) => ({
                      ...current,
                      categoryRank: Number(event.target.value),
                    }))
                  }
                >
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </RuleToggle>

              <RuleToggle
                label="距离阈值"
                checked={rules.proximityEnabled}
                onChecked={(checked) =>
                  setRules((current) => ({ ...current, proximityEnabled: checked }))
                }
              >
                <div className="coordinate-row">
                  <input
                    aria-label="关注点纬度"
                    type="number"
                    step="0.1"
                    value={rules.watchLatitude}
                    onChange={(event) =>
                      setRules((current) => ({
                        ...current,
                        watchLatitude: Number(event.target.value),
                      }))
                    }
                  />
                  <input
                    aria-label="关注点经度"
                    type="number"
                    step="0.1"
                    value={rules.watchLongitude}
                    onChange={(event) =>
                      setRules((current) => ({
                        ...current,
                        watchLongitude: Number(event.target.value),
                      }))
                    }
                  />
                </div>
                <input
                  type="range"
                  min="100"
                  max="1200"
                  value={rules.radiusKm}
                  onChange={(event) =>
                    setRules((current) => ({
                      ...current,
                      radiusKm: Number(event.target.value),
                    }))
                  }
                />
                <strong>{rules.radiusKm} km</strong>
              </RuleToggle>

              <RuleToggle
                label="快速增强"
                checked={rules.rapidIntensityEnabled}
                onChecked={(checked) =>
                  setRules((current) => ({
                    ...current,
                    rapidIntensityEnabled: checked,
                  }))
                }
              >
                <input
                  type="number"
                  min="5"
                  max="80"
                  value={rules.trendKmh}
                  onChange={(event) =>
                    setRules((current) => ({
                      ...current,
                      trendKmh: Number(event.target.value),
                    }))
                  }
                />
                <strong>km/h</strong>
              </RuleToggle>

              <button
                className="primary-button"
                type="button"
                disabled={checking}
                onClick={() => runAlertCheck(false)}
              >
                {checking ? "校验中" : "校验并发送"}
              </button>

              {alertStatus ? (
                <div className={`alert-result ${alertStatus.status}`}>
                  <strong>{alertStatus.message}</strong>
                  {alertStatus.matches.length > 0 ? (
                    <ul>
                      {alertStatus.matches.map((match) => (
                        <li key={match.typhoonName}>
                          {match.typhoonName}：{match.reasons[0]}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        ) : (
          <div className="empty-state">
            <h2>正在连接实时数据</h2>
            <p>监测台会在数据返回后自动更新。</p>
          </div>
        )}
      </section>
    </main>
  );
}

function TrackMap({ typhoon }: { typhoon: TyphoonSystem }) {
  const bounds = { minLon: 100, maxLon: 150, minLat: 0, maxLat: 35 };
  const plot = (point: TyphoonPoint) => {
    const x =
      ((point.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) *
      100;
    const y =
      100 -
      ((point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) *
        100;

    return {
      x: Math.max(4, Math.min(96, x)),
      y: Math.max(6, Math.min(94, y)),
    };
  };
  const observed = typhoon.points.filter((point) => point.kind !== "forecast");
  const forecast = typhoon.points.filter((point) => point.kind === "forecast");
  const observedPath = observed
    .map((point, index) => {
      const { x, y } = plot(point);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const forecastPath = [typhoon.latest, ...forecast]
    .map((point, index) => {
      const { x, y } = plot(point);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="track-map">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${typhoon.name} 路径图`}>
        <defs>
          <linearGradient id="seaGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#d8f0f2" />
            <stop offset="100%" stopColor="#edf5ef" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#seaGradient)" />
        {[20, 40, 60, 80].map((value) => (
          <g key={value} opacity="0.35">
            <line x1={value} y1="0" x2={value} y2="100" stroke="#7c98a3" />
            <line x1="0" y1={value} x2="100" y2={value} stroke="#7c98a3" />
          </g>
        ))}
        <path
          d="M8,26 C18,20 23,30 30,24 C38,18 45,24 52,18 C63,10 72,22 86,15 L96,20 L96,0 L8,0 Z"
          fill="#e0d7be"
          opacity="0.9"
        />
        <path
          d="M55,68 C62,62 67,68 73,62 C80,55 87,62 94,55 L98,100 L50,100 Z"
          fill="#e0d7be"
          opacity="0.72"
        />
        {observedPath ? (
          <path d={observedPath} fill="none" stroke="#0f6f7a" strokeWidth="1.8" />
        ) : null}
        {forecastPath ? (
          <path
            d={forecastPath}
            fill="none"
            stroke="#d95f43"
            strokeDasharray="3 2"
            strokeWidth="1.6"
          />
        ) : null}
        {typhoon.points.map((point) => {
          const { x, y } = plot(point);
          return (
            <circle
              key={point.id}
              cx={x}
              cy={y}
              r={point.kind === "analysis" ? 2.7 : 1.8}
              fill={point.kind === "forecast" ? "#d95f43" : "#0f6f7a"}
              stroke="#ffffff"
              strokeWidth="0.7"
            />
          );
        })}
      </svg>
      <div className="map-legend">
        <span><i className="past-dot" /> 实况路径</span>
        <span><i className="forecast-dot" /> 预报路径</span>
        <span>{typhoon.latest.latitude.toFixed(1)}°N / {typhoon.latest.longitude.toFixed(1)}°E</span>
      </div>
    </div>
  );
}

function IntensityChart({ points }: { points: TyphoonPoint[] }) {
  const values = points.map((point) => point.maxWindKmh);
  const max = Math.max(220, ...values);
  const min = Math.min(0, ...values);
  const line = points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 100 - ((point.maxWindKmh - min) / (max - min)) * 86 - 7;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="intensity-chart">
      <svg viewBox="0 0 100 100" role="img" aria-label="风速趋势">
        {[63, 88, 118, 150, 185].map((threshold) => {
          const y = 100 - ((threshold - min) / (max - min)) * 86 - 7;
          return (
            <g key={threshold}>
              <line x1="0" x2="100" y1={y} y2={y} stroke="#d7e0de" />
              <text x="2" y={y - 1.5} fontSize="3.2" fill="#63736f">
                {threshold}
              </text>
            </g>
          );
        })}
        <path d={line} fill="none" stroke="#d95f43" strokeWidth="2" />
        {points.map((point, index) => {
          const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
          const y = 100 - ((point.maxWindKmh - min) / (max - min)) * 86 - 7;
          return (
            <circle
              key={point.id}
              cx={x}
              cy={y}
              r="2"
              fill={point.kind === "forecast" ? "#d95f43" : "#0f6f7a"}
              stroke="#ffffff"
              strokeWidth="0.7"
            />
          );
        })}
      </svg>
      <div className="chart-caption">近中心最大风速 km/h</div>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  compact,
}: {
  label: string;
  value: string;
  suffix?: string;
  compact?: boolean;
}) {
  return (
    <div className={`metric ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <strong>
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </strong>
    </div>
  );
}

function RuleToggle({
  label,
  checked,
  onChecked,
  children,
}: {
  label: string;
  checked: boolean;
  onChecked: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rule-block">
      <label className="rule-heading">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <div className="rule-control">{children}</div>
    </div>
  );
}

function toAlertRules(rules: AlertFormState): AlertRules {
  return {
    recipients: rules.recipients
      .split(/[,\s;]+/)
      .map((recipient) => recipient.trim())
      .filter(Boolean),
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
  if (state === "loading") {
    return "连接中";
  }

  if (state === "error") {
    return "异常";
  }

  if (!dashboard) {
    return "待确认";
  }

  if (dashboard.typhoons.length === 0) {
    return "未生成";
  }

  return "已生成";
}

function formatTime(value: string | undefined) {
  if (!value) {
    return "等待中";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function riskLabel(level: TyphoonSystem["metrics"]["riskLevel"]) {
  return {
    low: "低风险",
    moderate: "关注",
    high: "高风险",
    extreme: "极高风险",
  }[level];
}
