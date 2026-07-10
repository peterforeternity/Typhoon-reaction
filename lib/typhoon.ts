export type TrackPointKind = "past" | "analysis" | "forecast";

export interface TyphoonPoint {
  id: string;
  kind: TrackPointKind;
  time: string;
  timestamp: string | null;
  latitude: number;
  longitude: number;
  intensity: string;
  categoryRank: number;
  categoryLabel: string;
  maxWindKmh: number;
}

export interface TyphoonMetrics {
  currentWindKmh: number;
  peakForecastWindKmh: number;
  windTrendKmh: number;
  movementKmh: number;
  movementBearing: string;
  observedPointCount: number;
  forecastPointCount: number;
  riskLevel: "low" | "moderate" | "high" | "extreme";
}

export interface TyphoonSystem {
  id: string;
  name: string;
  chineseName: string;
  englishName: string;
  bulletinTime: string;
  sourceUrl: string;
  points: TyphoonPoint[];
  latest: TyphoonPoint;
  metrics: TyphoonMetrics;
}

export interface TyphoonDashboard {
  source: {
    name: string;
    url: string;
    fetchedAt: string;
    status: "live" | "fallback";
    message: string;
  };
  typhoons: TyphoonSystem[];
}

export interface AlertRules {
  recipients: string[];
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
}

export interface AlertMatch {
  typhoonId: string;
  typhoonName: string;
  severity: TyphoonMetrics["riskLevel"];
  currentWindKmh: number;
  distanceKm: number | null;
  reasons: string[];
}

const HKO_LIST_URL = "https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml";
const DEFAULT_SOURCE_NAME = "香港天文台热带气旋路径开放数据";

export async function getTyphoonDashboard(): Promise<TyphoonDashboard> {
  const fetchedAt = new Date().toISOString();

  try {
    const typhoons = await fetchHkoTyphoons();
    return {
      source: {
        name: DEFAULT_SOURCE_NAME,
        url: HKO_LIST_URL,
        fetchedAt,
        status: "live",
        message:
          typhoons.length > 0
            ? "已连接官方实时路径数据"
            : "官方列表当前未发布活跃热带气旋路径",
      },
      typhoons,
    };
  } catch (error) {
    return {
      source: {
        name: DEFAULT_SOURCE_NAME,
        url: HKO_LIST_URL,
        fetchedAt,
        status: "fallback",
        message:
          error instanceof Error
            ? `实时数据暂不可用，已切换到演示样本：${error.message}`
            : "实时数据暂不可用，已切换到演示样本",
      },
      typhoons: [sampleTyphoon()],
    };
  }
}

export function evaluateAlertRules(
  typhoons: TyphoonSystem[],
  rules: AlertRules,
): AlertMatch[] {
  return typhoons.flatMap((typhoon) => {
    const reasons: string[] = [];
    const distance = rules.proximityEnabled
      ? distanceKm(
          typhoon.latest.latitude,
          typhoon.latest.longitude,
          rules.watchLatitude,
          rules.watchLongitude,
        )
      : null;

    if (
      rules.minWindEnabled &&
      typhoon.metrics.currentWindKmh >= rules.minWindKmh
    ) {
      reasons.push(
        `当前近中心最大风速 ${typhoon.metrics.currentWindKmh} km/h 已达到 ${rules.minWindKmh} km/h 阈值`,
      );
    }

    if (
      rules.categoryEnabled &&
      typhoon.latest.categoryRank >= rules.categoryRank
    ) {
      reasons.push(
        `当前等级为 ${typhoon.latest.categoryLabel}，达到预警等级阈值`,
      );
    }

    if (
      rules.proximityEnabled &&
      distance !== null &&
      distance <= rules.radiusKm
    ) {
      reasons.push(
        `距关注点约 ${Math.round(distance)} km，进入 ${rules.radiusKm} km 预警圈`,
      );
    }

    if (
      rules.rapidIntensityEnabled &&
      typhoon.metrics.windTrendKmh >= rules.trendKmh
    ) {
      reasons.push(
        `近期风速增强 ${typhoon.metrics.windTrendKmh} km/h，达到快速增强条件`,
      );
    }

    if (reasons.length === 0) {
      return [];
    }

    return [
      {
        typhoonId: typhoon.id,
        typhoonName: typhoon.name,
        severity: typhoon.metrics.riskLevel,
        currentWindKmh: typhoon.metrics.currentWindKmh,
        distanceKm: distance === null ? null : Math.round(distance),
        reasons,
      },
    ];
  });
}

async function fetchHkoTyphoons(): Promise<TyphoonSystem[]> {
  const listXml = await fetchText(HKO_LIST_URL);
  const entries = blocks(listXml, "TropicalCyclone");
  const systems = await Promise.all(
    entries
      .map((entry, index) => {
        const sourceUrl = normalizeUrl(
          textOf(entry, [
            "TropicalCycloneURL",
            "TropicalCycloneTrackURL",
            "TropicalCycloneInfoURL",
            "TrackURL",
          ]),
        );

        return {
          id:
            textOf(entry, ["TropicalCycloneID", "TCID", "ID"]) ||
            `hko-${index + 1}`,
          chineseName: textOf(entry, [
            "TropicalCycloneChineseName",
            "ChineseName",
          ]),
          englishName: textOf(entry, [
            "TropicalCycloneEnglishName",
            "EnglishName",
          ]),
          sourceUrl,
        };
      })
      .filter((entry) => entry.sourceUrl)
      .map(async (entry) => {
        const trackXml = await fetchText(entry.sourceUrl);
        return parseHkoTrack(trackXml, entry);
      }),
  );

  return systems.filter((system): system is TyphoonSystem => Boolean(system));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/xml,text/xml,*/*",
      "user-agent": "Typhoon-Monitoring-Platform/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

function parseHkoTrack(
  xml: string,
  meta: {
    id: string;
    chineseName: string;
    englishName: string;
    sourceUrl: string;
  },
): TyphoonSystem | null {
  const past = blocks(xml, "PastInformation").map((block, index) =>
    pointFromBlock(block, "past", index),
  ).filter(isTyphoonPoint);
  const analysis = blocks(xml, "AnalysisInformation").map((block, index) =>
    pointFromBlock(block, "analysis", index),
  ).filter(isTyphoonPoint);
  const forecast = blocks(xml, "ForecastInformation").map((block, index) =>
    pointFromBlock(block, "forecast", index),
  ).filter(isTyphoonPoint);
  const points = [...past, ...analysis, ...forecast]
    .sort((a, b) => pointSortValue(a) - pointSortValue(b));

  if (points.length === 0) {
    return null;
  }

  const latest =
    [...points].reverse().find((point) => point.kind !== "forecast") ??
    points[points.length - 1];
  const observed = points.filter((point) => point.kind !== "forecast");
  const nameFromTrack = textOf(xml, [
    "TropicalCycloneName",
    "CycloneName",
    "Name",
  ]);
  const englishName = meta.englishName || nameFromTrack || meta.id;
  const chineseName = meta.chineseName || "";

  return {
    id: meta.id,
    name: chineseName ? `${chineseName} ${englishName}` : englishName,
    chineseName,
    englishName,
    bulletinTime:
      textOf(xml, ["BulletinTime", "IssueTime", "LastUpdateTime"]) ||
      latest.time,
    sourceUrl: meta.sourceUrl,
    points,
    latest,
    metrics: buildMetrics(observed, forecast, latest),
  };
}

function isTyphoonPoint(point: TyphoonPoint | null): point is TyphoonPoint {
  return point !== null;
}

function pointFromBlock(
  block: string,
  kind: TrackPointKind,
  index: number,
): TyphoonPoint | null {
  const latitude = coordinate(textOf(block, ["Latitude", "Lat"]));
  const longitude = coordinate(textOf(block, ["Longitude", "Lon", "Long"]));
  const rawTime = textOf(block, [
    "Time",
    "ForecastTime",
    "AnalysisTime",
    "Datetime",
  ]);
  const windText = textOf(block, ["MaximumWind", "MaxWind", "Wind"]);
  const intensity = textOf(block, ["Intensity", "Classification", "Category"]);

  if (latitude === null || longitude === null) {
    return null;
  }

  if (kind === "forecast" && !rawTime) {
    return null;
  }

  if (kind !== "forecast" && (!rawTime || !windText || !intensity)) {
    return null;
  }

  const maxWindKmh = integer(windText);
  const rank = categoryRank(intensity, maxWindKmh);

  return {
    id: `${kind}-${index + 1}`,
    kind,
    time: rawTime || `${kind}-${index + 1}`,
    timestamp: normalizedTimestamp(rawTime),
    latitude,
    longitude,
    intensity: intensity || "未知",
    categoryRank: rank,
    categoryLabel: categoryLabel(rank),
    maxWindKmh,
  };
}

function buildMetrics(
  observed: TyphoonPoint[],
  forecast: TyphoonPoint[],
  latest: TyphoonPoint,
): TyphoonMetrics {
  const currentWindKmh = latest.maxWindKmh;
  const peakForecastWindKmh = Math.max(
    currentWindKmh,
    ...forecast.map((point) => point.maxWindKmh),
  );
  const trendWindow = observed.slice(-4);
  const windTrendKmh =
    trendWindow.length >= 2
      ? currentWindKmh - trendWindow[0].maxWindKmh
      : forecast[0]
        ? forecast[0].maxWindKmh - currentWindKmh
        : 0;
  const movement = movementFromObserved(observed);
  const riskScore =
    latest.categoryRank * 18 +
    currentWindKmh * 0.33 +
    Math.max(windTrendKmh, 0) * 1.2 +
    Math.max(peakForecastWindKmh - currentWindKmh, 0) * 0.6;

  return {
    currentWindKmh,
    peakForecastWindKmh,
    windTrendKmh: Math.round(windTrendKmh),
    movementKmh: movement.speedKmh,
    movementBearing: movement.bearing,
    observedPointCount: observed.length,
    forecastPointCount: forecast.length,
    riskLevel:
      riskScore >= 145
        ? "extreme"
        : riskScore >= 105
          ? "high"
          : riskScore >= 65
            ? "moderate"
            : "low",
  };
}

function movementFromObserved(points: TyphoonPoint[]) {
  const recent = points
    .filter((point) => point.timestamp)
    .slice(-2);

  if (recent.length < 2) {
    return { speedKmh: 0, bearing: "未定" };
  }

  const [previous, current] = recent;
  const hours =
    (new Date(current.timestamp ?? "").getTime() -
      new Date(previous.timestamp ?? "").getTime()) /
    3_600_000;

  if (!Number.isFinite(hours) || hours <= 0) {
    return { speedKmh: 0, bearing: "未定" };
  }

  return {
    speedKmh: Math.round(
      distanceKm(
        previous.latitude,
        previous.longitude,
        current.latitude,
        current.longitude,
      ) / hours,
    ),
    bearing: bearingLabel(
      bearingDegrees(
        previous.latitude,
        previous.longitude,
        current.latitude,
        current.longitude,
      ),
    ),
  };
}

function blocks(xml: string, tagName: string): string[] {
  const matcher = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "gi",
  );
  return [...xml.matchAll(matcher)].map((match) => match[1]);
}

function textOf(xml: string, tagNames: string[]): string {
  for (const tagName of tagNames) {
    const matcher = new RegExp(
      `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
      "i",
    );
    const match = xml.match(matcher);

    if (match?.[1]) {
      return decodeXml(match[1].trim());
    }
  }

  return "";
}

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeUrl(url: string): string {
  if (!url) {
    return "";
  }

  try {
    return new URL(url, "https://www.weather.gov.hk").toString();
  } catch {
    return "";
  }
}

function integer(value: string): number {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Math.round(Number(match[0])) : 0;
}

function coordinate(value: string): number | null {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*([NSEW])?/i);

  if (!match) {
    return null;
  }

  const direction = match[2]?.toUpperCase();
  const number = Number(match[1]);
  return direction === "S" || direction === "W" ? -number : number;
}

function normalizedTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T/i.test(value)) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function pointSortValue(point: TyphoonPoint): number {
  if (!point.timestamp) {
    return point.kind === "forecast" ? 2_000_000_000_000 : 1_000_000_000_000;
  }

  return new Date(point.timestamp).getTime();
}

function categoryRank(intensity: string, windKmh: number): number {
  const label = intensity.toLowerCase();

  if (label.includes("super") || intensity.includes("超强")) {
    return 6;
  }

  if (label.includes("severe typhoon") || intensity.includes("强台风")) {
    return 5;
  }

  if (label.includes("typhoon") || intensity.includes("台风")) {
    return 4;
  }

  if (
    label.includes("severe tropical storm") ||
    intensity.includes("强热带风暴")
  ) {
    return 3;
  }

  if (label.includes("tropical storm") || intensity.includes("热带风暴")) {
    return 2;
  }

  if (
    label.includes("tropical depression") ||
    intensity.includes("热带低压")
  ) {
    return 1;
  }

  if (windKmh >= 185) {
    return 6;
  }

  if (windKmh >= 150) {
    return 5;
  }

  if (windKmh >= 118) {
    return 4;
  }

  if (windKmh >= 88) {
    return 3;
  }

  if (windKmh >= 63) {
    return 2;
  }

  if (windKmh >= 41) {
    return 1;
  }

  return 0;
}

function categoryLabel(rank: number): string {
  return (
    [
      "扰动/低压",
      "热带低压",
      "热带风暴",
      "强热带风暴",
      "台风",
      "强台风",
      "超强台风",
    ][rank] ?? "未知"
  );
}

export function distanceKm(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const earthRadiusKm = 6371;
  const dLat = radians(latB - latA);
  const dLon = radians(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(latA)) *
      Math.cos(radians(latB)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const y = Math.sin(radians(lonB - lonA)) * Math.cos(radians(latB));
  const x =
    Math.cos(radians(latA)) * Math.sin(radians(latB)) -
    Math.sin(radians(latA)) *
      Math.cos(radians(latB)) *
      Math.cos(radians(lonB - lonA));

  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function bearingLabel(degreesValue: number): string {
  const labels = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return labels[Math.round(degreesValue / 45) % labels.length];
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function degrees(value: number): number {
  return (value * 180) / Math.PI;
}

function sampleTyphoon(): TyphoonSystem {
  const now = Date.now();
  const rawPoints = [
    ["past", -30, 15.2, 130.8, "Tropical Storm", 75],
    ["past", -24, 16.1, 129.6, "Severe Tropical Storm", 95],
    ["past", -18, 17.1, 128.3, "Typhoon", 120],
    ["analysis", 0, 18.4, 126.8, "Typhoon", 135],
    ["forecast", 12, 19.7, 125.0, "Severe Typhoon", 155],
    ["forecast", 24, 21.2, 123.2, "Severe Typhoon", 165],
    ["forecast", 36, 22.6, 121.3, "Typhoon", 145],
  ] as const;

  const points = rawPoints.map(([kind, offsetHours, lat, lon, intensity, wind], index) => {
    const rank = categoryRank(intensity, wind);
    const timestamp = new Date(now + offsetHours * 3_600_000).toISOString();

    return {
      id: `${kind}-${index}`,
      kind,
      time: timestamp,
      timestamp,
      latitude: lat,
      longitude: lon,
      intensity,
      categoryRank: rank,
      categoryLabel: categoryLabel(rank),
      maxWindKmh: wind,
    };
  });
  const observed = points.filter((point) => point.kind !== "forecast");
  const forecast = points.filter((point) => point.kind === "forecast");
  const latest = observed[observed.length - 1];

  return {
    id: "demo-aurora",
    name: "演示台风 AURORA",
    chineseName: "演示台风",
    englishName: "AURORA",
    bulletinTime: latest.timestamp ?? latest.time,
    sourceUrl: HKO_LIST_URL,
    points,
    latest,
    metrics: buildMetrics(observed, forecast, latest),
  };
}
