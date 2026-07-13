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

export interface WindForecastPoint {
  timestamp: string;
  horizonHours: number;
  period: "current" | "short" | "medium";
  windKmh: number;
  lowerKmh: number;
  upperKmh: number;
  categoryLabel: string;
}

export interface ImpactRegion {
  id: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  riskLevel: "watch" | "elevated" | "high" | "severe";
  closestDistanceKm: number;
  forecastWindKmh: number;
  impactRadiusKm: number;
  uncertaintyRadiusKm: number;
  eta: string;
  windowStart: string;
  windowEnd: string;
  confidence: "高" | "中" | "低";
}

export interface RegionalWindObservation {
  station: string;
  observedAt: string;
  direction: string;
  meanWindKmh: number | null;
  gustKmh: number | null;
}

export interface DataFeedStatus {
  id: string;
  name: string;
  cadence: string;
  role: string;
  url: string;
  status: "live" | "reference" | "degraded";
  recordCount: number;
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
  windForecast: WindForecastPoint[];
  impactRegions: ImpactRegion[];
}

export interface TyphoonDashboard {
  source: {
    name: string;
    url: string;
    fetchedAt: string;
    status: "live" | "fallback";
    message: string;
  };
  sources: DataFeedStatus[];
  regionalWinds: RegionalWindObservation[];
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
  forecastPeakWindKmh: number;
  distanceKm: number | null;
  warningLevel: string;
  expectedImpactStart: string | null;
  expectedImpactEnd: string | null;
  impactRegions: string[];
  recommendations: string[];
  reasons: string[];
}

const HKO_LIST_URL = "https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml";
const HKO_REGIONAL_WIND_URL =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv";
const NOAA_IBTRACS_URL =
  "https://www.ncei.noaa.gov/products/international-best-track-archive";
const DEFAULT_SOURCE_NAME = "香港天文台热带气旋路径开放数据";

const IMPACT_LOCATIONS = [
  ["hong-kong", "香港", "中国", 22.3193, 114.1694],
  ["macao", "澳门", "中国", 22.1987, 113.5439],
  ["shenzhen", "深圳", "中国", 22.5431, 114.0579],
  ["zhuhai", "珠海", "中国", 22.271, 113.5767],
  ["guangzhou", "广州", "中国", 23.1291, 113.2644],
  ["shantou", "汕头", "中国", 23.3541, 116.682],
  ["xiamen", "厦门", "中国", 24.4798, 118.0894],
  ["fuzhou", "福州", "中国", 26.0745, 119.2965],
  ["wenzhou", "温州", "中国", 27.9949, 120.6994],
  ["ningbo", "宁波", "中国", 29.8683, 121.544],
  ["shanghai", "上海", "中国", 31.2304, 121.4737],
  ["haikou", "海口", "中国", 20.044, 110.1999],
  ["sanya", "三亚", "中国", 18.2528, 109.5119],
  ["zhanjiang", "湛江", "中国", 21.2707, 110.3594],
  ["taipei", "台北", "中国台湾", 25.033, 121.5654],
  ["kaohsiung", "高雄", "中国台湾", 22.6273, 120.3014],
  ["manila", "马尼拉", "菲律宾", 14.5995, 120.9842],
  ["laoag", "拉瓦格", "菲律宾", 18.196, 120.5927],
  ["okinawa", "冲绳本岛", "日本", 26.3344, 127.8056],
] as const;

export async function getTyphoonDashboard(): Promise<TyphoonDashboard> {
  const fetchedAt = new Date().toISOString();
  const [trackResult, windResult] = await Promise.allSettled([
    fetchHkoTyphoons(),
    fetchRegionalWinds(),
  ]);
  const trackLive = trackResult.status === "fulfilled";
  const typhoons = trackLive ? trackResult.value : [sampleTyphoon()];
  const regionalWinds =
    windResult.status === "fulfilled" ? windResult.value : [];

  return {
    source: {
      name: DEFAULT_SOURCE_NAME,
      url: HKO_LIST_URL,
      fetchedAt,
      status: trackLive ? "live" : "fallback",
      message: trackLive
        ? typhoons.length > 0
          ? "官方路径与区域风场已完成同步"
          : "官方列表当前未发布活跃热带气旋路径"
        : "实时路径暂不可用，已切换到演示样本",
    },
    sources: [
      {
        id: "hko-track",
        name: "香港天文台路径预报",
        cadence: "发布即更新",
        role: "路径、中心风速与强度预报",
        url: HKO_LIST_URL,
        status: trackLive ? "live" : "degraded",
        recordCount: typhoons.reduce(
          (total, typhoon) => total + typhoon.points.length,
          0,
        ),
      },
      {
        id: "hko-wind",
        name: "香港区域自动气象站",
        cadence: "每 10 分钟",
        role: "地面平均风与阵风验证",
        url: HKO_REGIONAL_WIND_URL,
        status: windResult.status === "fulfilled" ? "live" : "degraded",
        recordCount: regionalWinds.length,
      },
      {
        id: "noaa-ibtracs",
        name: "NOAA IBTrACS 历史档案",
        cadence: "历史基线",
        role: "历史路径与强度方法参考",
        url: NOAA_IBTRACS_URL,
        status: "reference",
        recordCount: 0,
      },
    ],
    regionalWinds,
    typhoons,
  };
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

    const affected = typhoon.impactRegions.slice(0, 6);
    const expectedImpactStart = affected.length
      ? affected.reduce((earliest, region) =>
          new Date(region.windowStart).getTime() < new Date(earliest).getTime()
            ? region.windowStart
            : earliest,
        affected[0].windowStart)
      : null;
    const expectedImpactEnd = affected.length
      ? affected.reduce((latest, region) =>
          new Date(region.windowEnd).getTime() > new Date(latest).getTime()
            ? region.windowEnd
            : latest,
        affected[0].windowEnd)
      : null;

    return [
      {
        typhoonId: typhoon.id,
        typhoonName: typhoon.name,
        severity: typhoon.metrics.riskLevel,
        currentWindKmh: typhoon.metrics.currentWindKmh,
        forecastPeakWindKmh: typhoon.metrics.peakForecastWindKmh,
        distanceKm: distance === null ? null : Math.round(distance),
        warningLevel: warningLevel(typhoon.metrics.riskLevel),
        expectedImpactStart,
        expectedImpactEnd,
        impactRegions: affected.map(
          (region) => `${region.name}（${impactRiskLabel(region.riskLevel)}）`,
        ),
        recommendations: alertRecommendations(typhoon.metrics.riskLevel),
        reasons,
      },
    ];
  });
}

function warningLevel(level: TyphoonMetrics["riskLevel"]): string {
  return {
    low: "蓝色关注",
    moderate: "黄色预警",
    high: "橙色预警",
    extreme: "红色预警",
  }[level];
}

function impactRiskLabel(level: ImpactRegion["riskLevel"]): string {
  return {
    watch: "关注",
    elevated: "较高",
    high: "高",
    severe: "严重",
  }[level];
}

function alertRecommendations(
  level: TyphoonMetrics["riskLevel"],
): string[] {
  const common = [
    "持续关注当地气象部门发布的最新预警和防御指引",
    "检查门窗、排水与户外悬挂物，准备照明和通信备用电源",
  ];

  if (level === "high" || level === "extreme") {
    return [
      ...common,
      "暂停海上、高空及临水作业，船只尽快进入安全水域避风",
      "提前规划避险路线，按属地要求做好转移准备",
    ];
  }

  return [...common, "调整非必要户外活动并留意交通服务变化"];
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

async function fetchRegionalWinds(): Promise<RegionalWindObservation[]> {
  const csv = await fetchText(HKO_REGIONAL_WIND_URL, "text/csv,*/*");
  const rows = csv.trim().split(/\r?\n/).slice(1);

  return rows.flatMap((row) => {
    const [rawTime, station, direction, meanWind, gust] = row
      .split(",")
      .map((value) => value.trim());

    if (!rawTime || !station) {
      return [];
    }

    return [
      {
        station,
        observedAt: compactTimestamp(rawTime),
        direction: direction || "N/A",
        meanWindKmh: csvWindValue(meanWind),
        gustKmh: csvWindValue(gust),
      },
    ];
  });
}

async function fetchText(
  url: string,
  accept = "application/xml,text/xml,*/*",
): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept,
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
    windForecast: buildWindForecast(latest, forecast),
    impactRegions: buildImpactRegions(latest, forecast),
  };
}

function buildWindForecast(
  latest: TyphoonPoint,
  forecast: TyphoonPoint[],
): WindForecastPoint[] {
  const baseTime = latest.timestamp
    ? new Date(latest.timestamp).getTime()
    : Date.now();
  const candidates = [latest, ...forecast]
    .filter((point) => point.timestamp)
    .filter(
      (point, index, values) =>
        values.findIndex((other) => other.timestamp === point.timestamp) ===
        index,
    );

  return candidates.map((point) => {
    const horizonHours = Math.max(
      0,
      Math.round(
        (new Date(point.timestamp ?? baseTime).getTime() - baseTime) / 3_600_000,
      ),
    );
    const spread = Math.min(34, 6 + horizonHours * 0.22);

    return {
      timestamp: point.timestamp ?? new Date(baseTime).toISOString(),
      horizonHours,
      period:
        horizonHours === 0
          ? "current"
          : horizonHours <= 24
            ? "short"
            : "medium",
      windKmh: point.maxWindKmh,
      lowerKmh: Math.max(0, Math.round(point.maxWindKmh - spread)),
      upperKmh: Math.round(point.maxWindKmh + spread),
      categoryLabel: point.categoryLabel,
    };
  });
}

function buildImpactRegions(
  latest: TyphoonPoint,
  forecast: TyphoonPoint[],
): ImpactRegion[] {
  const baseTime = latest.timestamp
    ? new Date(latest.timestamp).getTime()
    : Date.now();
  const track = [latest, ...forecast].filter((point) => point.timestamp);

  return IMPACT_LOCATIONS.flatMap(
    ([id, name, country, latitude, longitude]) => {
      const closest = track
        .map((point) => {
          const horizonHours = Math.max(
            0,
            Math.round(
              (new Date(point.timestamp ?? baseTime).getTime() - baseTime) /
                3_600_000,
            ),
          );
          const impactRadiusKm = windImpactRadius(point.maxWindKmh);
          const uncertaintyRadiusKm = trackUncertaintyRadius(horizonHours);
          const closestDistanceKm = Math.round(
            distanceKm(
              latitude,
              longitude,
              point.latitude,
              point.longitude,
            ),
          );

          return {
            point,
            horizonHours,
            impactRadiusKm,
            uncertaintyRadiusKm,
            closestDistanceKm,
            marginKm:
              impactRadiusKm + uncertaintyRadiusKm - closestDistanceKm,
          };
        })
        .sort((a, b) => b.marginKm - a.marginKm)[0];

      if (!closest || closest.marginKm < 0) {
        return [];
      }

      const etaTime = new Date(closest.point.timestamp ?? baseTime);
      const windowHalfHours = closest.horizonHours <= 24 ? 6 : 12;
      const riskLevel = impactRiskLevel(
        closest.point.maxWindKmh,
        closest.closestDistanceKm,
        closest.impactRadiusKm,
      );

      return [
        {
          id,
          name,
          country,
          latitude,
          longitude,
          riskLevel,
          closestDistanceKm: closest.closestDistanceKm,
          forecastWindKmh: closest.point.maxWindKmh,
          impactRadiusKm: closest.impactRadiusKm,
          uncertaintyRadiusKm: closest.uncertaintyRadiusKm,
          eta: etaTime.toISOString(),
          windowStart: new Date(
            etaTime.getTime() - windowHalfHours * 3_600_000,
          ).toISOString(),
          windowEnd: new Date(
            etaTime.getTime() + windowHalfHours * 3_600_000,
          ).toISOString(),
          confidence:
            closest.horizonHours <= 24
              ? "高"
              : closest.horizonHours <= 72
                ? "中"
                : "低",
        },
      ];
    },
  )
    .sort((a, b) => {
      const riskOrder = { severe: 4, high: 3, elevated: 2, watch: 1 };
      return riskOrder[b.riskLevel] - riskOrder[a.riskLevel] ||
        new Date(a.eta).getTime() - new Date(b.eta).getTime();
    })
    .slice(0, 12);
}

function windImpactRadius(windKmh: number): number {
  if (windKmh >= 185) return 420;
  if (windKmh >= 150) return 360;
  if (windKmh >= 118) return 300;
  if (windKmh >= 88) return 240;
  if (windKmh >= 63) return 180;
  return 120;
}

function trackUncertaintyRadius(horizonHours: number): number {
  const anchors = [
    [0, 15],
    [24, 100],
    [48, 170],
    [72, 255],
    [96, 345],
    [120, 465],
  ] as const;

  for (let index = 1; index < anchors.length; index += 1) {
    const [endHour, endRadius] = anchors[index];
    const [startHour, startRadius] = anchors[index - 1];

    if (horizonHours <= endHour) {
      const progress = (horizonHours - startHour) / (endHour - startHour);
      return Math.round(startRadius + (endRadius - startRadius) * progress);
    }
  }

  return 465;
}

function impactRiskLevel(
  windKmh: number,
  distance: number,
  radius: number,
): ImpactRegion["riskLevel"] {
  const proximity = Math.max(0, 1 - distance / Math.max(radius, 1));
  const score = windKmh * 0.55 + proximity * 80;

  if (score >= 150) return "severe";
  if (score >= 115) return "high";
  if (score >= 80) return "elevated";
  return "watch";
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

function compactTimestamp(value: string): string {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/,
  );

  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
}

function csvWindValue(value: string | undefined): number | null {
  if (!value || value === "N/A") {
    return null;
  }

  if (value.toLowerCase() === "calm") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    windForecast: buildWindForecast(latest, forecast),
    impactRegions: buildImpactRegions(latest, forecast),
  };
}
