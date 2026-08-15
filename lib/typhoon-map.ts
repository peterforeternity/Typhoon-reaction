import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import land110m from "world-atlas/land-110m.json";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

import type { TyphoonSystem } from "@/lib/typhoon";

export const TYPHOON_MAP_CONTENT_ID = "typhoon-track-map";

export interface EmailMapAttachment {
  content: string;
  filename: string;
  content_id: string;
}

type Color = readonly [number, number, number, number];
type Point = readonly [number, number];

const WIDTH = 640;
const HEIGHT = 360;
const OCEAN: Color = [218, 236, 237, 255];
const LAND: Color = [238, 241, 232, 255];
const COAST: Color = [143, 167, 158, 255];
const GRID: Color = [177, 205, 201, 170];
const OBSERVED: Color = [26, 119, 138, 255];
const FORECAST: Color = [224, 139, 43, 255];
const CURRENT: Color = [196, 53, 49, 255];
const IMPACT: Color = [111, 72, 151, 210];
const WHITE: Color = [255, 255, 255, 255];

export async function createTyphoonMapAttachment(
  typhoons: TyphoonSystem[],
): Promise<EmailMapAttachment> {
  const png = await renderTyphoonMap(typhoons);
  return {
    content: bytesToBase64(png),
    filename: "typhoon-track-map.png",
    content_id: TYPHOON_MAP_CONTENT_ID,
  };
}

export async function renderTyphoonMap(
  typhoons: TyphoonSystem[],
): Promise<Uint8Array> {
  if (typhoons.length === 0) {
    throw new Error("Cannot render a typhoon map without an active system");
  }

  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  fillCanvas(pixels, OCEAN);
  const projection = buildProjection(typhoons);

  drawGrid(pixels, projection);
  drawLand(pixels, projection);

  typhoons.forEach((typhoon) => {
    const points = typhoon.points
      .map((point) => ({ ...point, projected: projection([point.longitude, point.latitude]) }))
      .filter(
        (point): point is typeof point & { projected: [number, number] } =>
          point.projected !== null,
      );

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const color = current.kind === "forecast" ? FORECAST : OBSERVED;
      drawLine(pixels, previous.projected, current.projected, color, 3);
    }

    typhoon.impactRegions.slice(0, 8).forEach((region) => {
      const projected = projection([region.longitude, region.latitude]);
      if (!projected) return;
      drawCircle(pixels, projected[0], projected[1], 5, IMPACT, false);
      drawCircle(pixels, projected[0], projected[1], 2, IMPACT, true);
    });

    const latest = projection([
      typhoon.latest.longitude,
      typhoon.latest.latitude,
    ]);
    if (latest) {
      drawCircle(pixels, latest[0], latest[1], 8, WHITE, true);
      drawCircle(pixels, latest[0], latest[1], 5, CURRENT, true);
    }
  });

  drawLegend(pixels);
  return encodePng(pixels, WIDTH, HEIGHT);
}

function buildProjection(typhoons: TyphoonSystem[]) {
  const coordinates = typhoons.flatMap((typhoon) => [
    ...typhoon.points.map((point) => [point.longitude, point.latitude] as Point),
    ...typhoon.impactRegions.map(
      (region) => [region.longitude, region.latitude] as Point,
    ),
  ]);
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  let minLongitude = Math.max(85, Math.min(...longitudes) - 6);
  let maxLongitude = Math.min(180, Math.max(...longitudes) + 6);
  let minLatitude = Math.max(-10, Math.min(...latitudes) - 5);
  let maxLatitude = Math.min(65, Math.max(...latitudes) + 5);

  const centerLongitude = (minLongitude + maxLongitude) / 2;
  const centerLatitude = (minLatitude + maxLatitude) / 2;
  const longitudeSpan = Math.max(24, maxLongitude - minLongitude);
  const latitudeSpan = Math.max(16, maxLatitude - minLatitude);
  const targetRatio = (WIDTH - 32) / (HEIGHT - 32);

  if (longitudeSpan / latitudeSpan < targetRatio) {
    const expanded = latitudeSpan * targetRatio;
    minLongitude = centerLongitude - expanded / 2;
    maxLongitude = centerLongitude + expanded / 2;
  } else {
    const expanded = longitudeSpan / targetRatio;
    minLatitude = centerLatitude - expanded / 2;
    maxLatitude = centerLatitude + expanded / 2;
  }

  const scale = Math.min(
    (WIDTH - 32) / radians(maxLongitude - minLongitude),
    (HEIGHT - 32) / radians(maxLatitude - minLatitude),
  );

  return geoEquirectangular()
    .center([
      (minLongitude + maxLongitude) / 2,
      (minLatitude + maxLatitude) / 2,
    ])
    .translate([WIDTH / 2, HEIGHT / 2])
    .scale(scale)
    .clipExtent([
      [0, 0],
      [WIDTH, HEIGHT],
    ]);
}

function drawGrid(
  pixels: Uint8Array,
  projection: ReturnType<typeof buildProjection>,
) {
  for (let longitude = -180; longitude <= 180; longitude += 10) {
    const points: Point[] = [];
    for (let latitude = -80; latitude <= 80; latitude += 2) {
      const projected = projection([longitude, latitude]);
      if (projected) points.push(projected);
    }
    drawPolyline(pixels, points, GRID, 1);
  }

  for (let latitude = -80; latitude <= 80; latitude += 10) {
    const points: Point[] = [];
    for (let longitude = -180; longitude <= 180; longitude += 2) {
      const projected = projection([longitude, latitude]);
      if (projected) points.push(projected);
    }
    drawPolyline(pixels, points, GRID, 1);
  }
}

function drawLand(
  pixels: Uint8Array,
  projection: ReturnType<typeof buildProjection>,
) {
  const topology = land110m as unknown as Topology<{
    land: GeometryCollection;
  }>;
  const land = feature(
    topology,
    topology.objects.land,
  ) as Feature<Polygon | MultiPolygon>;
  const collector = new PathCollector();
  collector.beginPath();
  geoPath(projection, collector)(land);

  collector.paths.forEach((path) => {
    if (path.length < 3) return;
    fillPolygon(pixels, path, LAND);
    drawPolyline(pixels, [...path, path[0]], COAST, 1);
  });
}

class PathCollector {
  paths: Point[][] = [];
  private current: Point[] | null = null;

  beginPath() {
    this.paths = [];
    this.current = null;
  }

  moveTo(x: number, y: number) {
    this.current = [[x, y]];
    this.paths.push(this.current);
  }

  lineTo(x: number, y: number) {
    this.current?.push([x, y]);
  }

  closePath() {
    this.current = null;
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ) {
    const steps = Math.max(8, Math.ceil(Math.abs(endAngle - startAngle) * 8));
    for (let index = 0; index <= steps; index += 1) {
      const angle = startAngle + ((endAngle - startAngle) * index) / steps;
      const point: Point = [
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
      ];
      if (index === 0) this.moveTo(...point);
      else this.lineTo(...point);
    }
  }
}

function drawLegend(pixels: Uint8Array) {
  const y = HEIGHT - 18;
  drawLine(pixels, [18, y], [48, y], OBSERVED, 3);
  drawLine(pixels, [65, y], [95, y], FORECAST, 3);
  drawCircle(pixels, 116, y, 5, CURRENT, true);
  drawCircle(pixels, 142, y, 4, IMPACT, false);
}

function drawPolyline(
  pixels: Uint8Array,
  points: Point[],
  color: Color,
  thickness: number,
) {
  for (let index = 1; index < points.length; index += 1) {
    drawLine(pixels, points[index - 1], points[index], color, thickness);
  }
}

function drawLine(
  pixels: Uint8Array,
  start: Point,
  end: Point,
  color: Color,
  thickness: number,
) {
  let x0 = Math.round(start[0]);
  let y0 = Math.round(start[1]);
  const x1 = Math.round(end[0]);
  const y1 = Math.round(end[1]);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    drawCircle(pixels, x0, y0, Math.max(0, Math.floor(thickness / 2)), color, true);
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function drawCircle(
  pixels: Uint8Array,
  centerX: number,
  centerY: number,
  radius: number,
  color: Color,
  filled: boolean,
) {
  const roundedX = Math.round(centerX);
  const roundedY = Math.round(centerY);
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distanceSquared = x * x + y * y;
      const inside = distanceSquared <= radius * radius;
      const border = distanceSquared >= Math.max(0, radius - 1) ** 2;
      if (inside && (filled || border)) {
        setPixel(pixels, roundedX + x, roundedY + y, color);
      }
    }
  }
}

function fillPolygon(pixels: Uint8Array, points: Point[], color: Color) {
  const minY = Math.max(0, Math.ceil(Math.min(...points.map((point) => point[1]))));
  const maxY = Math.min(
    HEIGHT - 1,
    Math.floor(Math.max(...points.map((point) => point[1]))),
  );

  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[previous];
      if ((y1 > y) !== (y2 > y)) {
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index]));
      const end = Math.min(WIDTH - 1, Math.floor(intersections[index + 1]));
      for (let x = start; x <= end; x += 1) setPixel(pixels, x, y, color);
    }
  }
}

function fillCanvas(pixels: Uint8Array, color: Color) {
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = color[3];
  }
}

function setPixel(pixels: Uint8Array, x: number, y: number, color: Color) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 4;
  const alpha = color[3] / 255;
  pixels[index] = Math.round(color[0] * alpha + pixels[index] * (1 - alpha));
  pixels[index + 1] = Math.round(
    color[1] * alpha + pixels[index + 1] * (1 - alpha),
  );
  pixels[index + 2] = Math.round(
    color[2] * alpha + pixels[index + 2] * (1 - alpha),
  );
  pixels[index + 3] = 255;
}

async function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const scanlines = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (width * 4 + 1);
    scanlines[outputOffset] = 0;
    scanlines.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      outputOffset + 1,
    );
  }

  const compressor = new CompressionStream("deflate");
  const writer = compressor.writable.getWriter();
  await writer.write(scanlines);
  await writer.close();
  const compressed = new Uint8Array(
    await new Response(compressor.readable).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);

  return concatenate([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(data.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(data.length + 8, crc32(concatenate([typeBytes, data])));
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
