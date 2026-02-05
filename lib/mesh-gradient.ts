// lib/mesh-gradient.ts

// ============ Types ============

export interface Point {
  x: number
  y: number
  color: string
}

export interface RGB {
  r: number
  g: number
  b: number
}

export interface Triangle {
  points: [Point, Point, Point]
  centroid: { x: number; y: number }
  area: number
  colorVariance: number
}

export interface DominantColor {
  color: RGB
  position: { x: number; y: number }
  weight: number
}

export interface BaseGradient {
  colors: DominantColor[]
  direction: { x1: number; y1: number; x2: number; y2: number }
}

export interface MoodSettings {
  pathSmoothing: number       // 1-4 Chaikin iterations (min 1 enforced)
  overlapAmount: number       // 1-1.2 shape expansion
  shapeOpacity: number        // 0.6-0.98 shape fill opacity
  adaptiveSensitivity: number // how much variance affects density
  minShapeScale: number       // smallest shape scale factor
  mergeThreshold: number      // color similarity for merging
  gradientConsistency: number // alignment to global direction
  baseGradientOpacity: number // 0-1 base layer strength
}

// ============ Canvas Preprocessing ============
// Use this to generate a smoothed, optionally downscaled context from an image/canvas.
// Pass the returned ctx into analyze/poisson/triangulate/generate functions for cleaner results.
export function createSmoothedContext(
  src: HTMLImageElement | HTMLCanvasElement,
  { scale = 0.65, blurPx = 1.2 }: { scale?: number; blurPx?: number } = {}
): CanvasRenderingContext2D {
  const w0 =
    src instanceof HTMLImageElement
      ? src.naturalWidth || (src as any).width || 1
      : (src as HTMLCanvasElement).width
  const h0 =
    src instanceof HTMLImageElement
      ? src.naturalHeight || (src as any).height || 1
      : (src as HTMLCanvasElement).height

  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(src as HTMLCanvasElement, 0, 0, w, h)

  // Apply a tiny blur to melt micro-noise (Firefox applies filter only to subsequent draws)
  if ("filter" in ctx) {
    ;(ctx as any).filter = `blur(${blurPx}px)`
    ctx.drawImage(canvas, 0, 0)
    ;(ctx as any).filter = "none"
  }
  return ctx
}

/**
 * Map mood slider (0=Structured, 100=Organic) to internal settings
 * Note: forced pathSmoothing >= 1 and slightly higher overlap for seam-free joins.
 */
export function moodToSettings(mood: number): MoodSettings {
  const t = mood / 100
  return {
    pathSmoothing: Math.max(1, Math.floor(t * 4)), // ensure at least 1 iteration
    overlapAmount: 1.06 + t * 0.12,                // 1.06 -> 1.18
    shapeOpacity: 0.97 - t * 0.3,                  // 0.97 -> 0.67
    adaptiveSensitivity: 0.25 + t * 0.45,          // 0.25 -> 0.70
    minShapeScale: 0.8 + t * 0.4,                  // 0.8  -> 1.2
    mergeThreshold: 0.15 + t * 0.35,               // 0.15 -> 0.50
    gradientConsistency: 0.35 + t * 0.55,          // 0.35 -> 0.90
    baseGradientOpacity: 0.25 + t * 0.55,          // 0.25 -> 0.80
  }
}

/**
 * Map mood (0-100) to Poisson disk min distance.
 * Higher mood = larger shapes = bigger spacing.
 * Slightly increased range + pixel floor to avoid micro triangles.
 */
export function moodToMinDistance(mood: number, width: number, height: number): number {
  const minSize = Math.min(width, height)
  const factor = 0.035 + (mood / 100) * 0.11 // 3.5% to 14.5% (larger than before)
  const px = minSize * factor
  return Math.max(px, 24) // never drop below 24px
}

// ============ Color Utilities ============

export function parseRGB(rgb: string): RGB {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!m) return { r: 0, g: 0, b: 0 }
  return { r: +m[1], g: +m[2], b: +m[3] }
}

export function rgbToString(c: RGB): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`
}

export function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!m) return "#000000"
  return "#" + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, "0")).join("")
}

export function rgbObjToHex(c: RGB): string {
  return "#" + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, "0")).join("")
}

function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

export function getLuminance(c: RGB): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
}

export function blendColors(colors: RGB[]): RGB {
  if (!colors.length) return { r: 0, g: 0, b: 0 }
  const n = colors.length
  return {
    r: Math.round(colors.reduce((s, c) => s + c.r, 0) / n),
    g: Math.round(colors.reduce((s, c) => s + c.g, 0) / n),
    b: Math.round(colors.reduce((s, c) => s + c.b, 0) / n),
  }
}

// ============ Canvas Sampling ============

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

export function sampleColor(ctx: CanvasRenderingContext2D, x: number, y: number): string {
  const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data
  return `rgb(${p[0]}, ${p[1]}, ${p[2]})`
}

function sampleRGB(ctx: CanvasRenderingContext2D, x: number, y: number): RGB {
  const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data
  return { r: p[0], g: p[1], b: p[2] }
}

/**
 * Average color over a small region to reduce noise.
 */
function sampleRegionAvg(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, w: number, h: number): RGB {
  const samples: RGB[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      samples.push(sampleRGB(ctx, clamp(x + dx * radius * 0.5, 0, w - 1), clamp(y + dy * radius * 0.5, 0, h - 1)))
    }
  }
  return blendColors(samples)
}

/**
 * Measure local color variance for adaptive density.
 */
function regionVariance(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, w: number, h: number): number {
  const center = sampleRGB(ctx, clamp(x, 0, w - 1), clamp(y, 0, h - 1))
  let total = 0
  const steps = 8
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const s = sampleRGB(ctx, clamp(x + Math.cos(angle) * radius, 0, w - 1), clamp(y + Math.sin(angle) * radius, 0, h - 1))
    total += colorDistance(s, center)
  }
  return total / steps
}

// ============ Image Analysis ============

export function analyzeBaseGradient(ctx: CanvasRenderingContext2D, w: number, h: number): BaseGradient {
  const gridSize = 6
  const cellW = w / gridSize, cellH = h / gridSize
  const samples: DominantColor[] = []

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const cx = (gx + 0.5) * cellW
      const cy = (gy + 0.5) * cellH
      const color = sampleRegionAvg(ctx, cx, cy, Math.min(cellW, cellH) * 0.3, w, h)
      samples.push({ color, position: { x: cx, y: cy }, weight: 1 })
    }
  }

  // Find the pair with the largest color distance for gradient direction
  let maxDist = 0, from = samples[0], to = samples[0]
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const d = colorDistance(samples[i].color, samples[j].color)
      if (d > maxDist) {
        maxDist = d
        if (getLuminance(samples[i].color) < getLuminance(samples[j].color)) {
          from = samples[i]; to = samples[j]
        } else {
          from = samples[j]; to = samples[i]
        }
      }
    }
  }

  return {
    colors: samples,
    direction: { x1: from.position.x / w, y1: from.position.y / h, x2: to.position.x / w, y2: to.position.y / h },
  }
}

// ============ Delaunay Triangulation (Bowyer-Watson) ============

class Delaunay {
  private pts: Array<{ x: number; y: number }>
  triangleIndices: number[] = []

  constructor(pts: Array<{ x: number; y: number }>) {
    this.pts = pts
    this.run()
  }

  private run() {
    const n = this.pts.length
    if (n < 3) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of this.pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
    }
    const dx = maxX - minX, dy = maxY - minY, d = Math.max(dx, dy)
    const mx = (minX + maxX) / 2, my = (minY + maxY) / 2

    const superTri: Array<{ x: number; y: number }> = [
      { x: mx - 20 * d, y: my - d },
      { x: mx, y: my + 20 * d },
      { x: mx + 20 * d, y: my - d },
    ]
    const all = [...this.pts, ...superTri]
    const s0 = n, s1 = n + 1, s2 = n + 2

    let tris: Array<[number, number, number]> = [[s0, s1, s2]]

    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      const bad: Array<[number, number, number]> = []
      for (const t of tris) {
        if (this.inCircumcircle(p, all[t[0]], all[t[1]], all[t[2]])) bad.push(t)
      }

      const poly: Array<[number, number]> = []
      for (const t of bad) {
        const edges: Array<[number, number]> = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]
        for (const e of edges) {
          let shared = false
          for (const o of bad) {
            if (t === o) continue
            const oe: Array<[number, number]> = [[o[0], o[1]], [o[1], o[2]], [o[2], o[0]]]
            for (const oe2 of oe) {
              if ((e[0] === oe2[0] && e[1] === oe2[1]) || (e[0] === oe2[1] && e[1] === oe2[0])) {
                shared = true; break
              }
            }
            if (shared) break
          }
          if (!shared) poly.push(e)
        }
      }

      tris = tris.filter(t => !bad.includes(t))
      for (const e of poly) tris.push([e[0], e[1], i])
    }

    tris = tris.filter(t => t[0] < n && t[1] < n && t[2] < n)
    this.triangleIndices = tris.flat()
  }

  private inCircumcircle(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean {
    const ax = a.x - p.x, ay = a.y - p.y
    const bx = b.x - p.x, by = b.y - p.y
    const cx = c.x - p.x, cy = c.y - p.y
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay)
    const ori = (a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x)
    return ori > 0 ? det > 0 : det < 0
  }
}

// ============ Adaptive Poisson Disk Sampling ============

export function adaptivePoissonSampling(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  baseMinDist: number,
  settings: MoodSettings,
  maxAttempts = 30
): Array<{ x: number; y: number }> {
  const cell = baseMinDist / Math.SQRT2
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell)
  const grid: (number | null)[][] = Array.from({ length: gw }, () => Array(gh).fill(null))
  const pts: Array<{ x: number; y: number }> = []
  const active: number[] = []

  const localDist = (x: number, y: number) => {
    const v = regionVariance(ctx, x, y, baseMinDist, w, h)
    const factor = Math.max(0.35, 1 - (v / 255) * settings.adaptiveSensitivity)
    return baseMinDist * factor * settings.minShapeScale
  }

  const tooClose = (x: number, y: number, md: number) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell)
    const r = Math.ceil(md / cell) + 1
    for (let i = Math.max(0, gx - r); i <= Math.min(gw - 1, gx + r); i++) {
      for (let j = Math.max(0, gy - r); j <= Math.min(gh - 1, gy + r); j++) {
        const idx = grid[i][j]
        if (idx !== null) {
          const dx = pts[idx].x - x, dy = pts[idx].y - y
          if (dx * dx + dy * dy < md * md) return true
        }
      }
    }
    return false
  }

  const addPoint = (x: number, y: number) => {
    const idx = pts.length
    pts.push({ x, y })
    active.push(idx)
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell)
    if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) grid[gx][gy] = idx
  }

  addPoint(w / 2, h / 2)

  while (active.length) {
    const ri = Math.floor(Math.random() * active.length)
    const pi = active[ri]
    const p = pts[pi]
    let found = false
    const ld = localDist(p.x, p.y)

    for (let a = 0; a < maxAttempts; a++) {
      const angle = Math.random() * Math.PI * 2
      const dist = ld + Math.random() * ld
      const nx = p.x + Math.cos(angle) * dist
      const ny = p.y + Math.sin(angle) * dist
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const nld = localDist(nx, ny)
        if (!tooClose(nx, ny, nld)) { addPoint(nx, ny); found = true; break }
      }
    }
    if (!found) active.splice(ri, 1)
  }
  return pts
}

export function addBoundaryPoints(pts: Array<{ x: number; y: number }>, w: number, h: number, spacing: number) {
  const bp: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }
  ]
  for (let x = spacing; x < w; x += spacing) { bp.push({ x, y: 0 }); bp.push({ x, y: h }) }
  for (let y = spacing; y < h; y += spacing) { bp.push({ x: 0, y }); bp.push({ x: w, y }) }
  return [...pts, ...bp]
}

// ============ Triangulation ============

export function triangulate(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, w: number, h: number): Triangle[] {
  const d = new Delaunay(pts)
  const idx = d.triangleIndices
  const result: Triangle[] = []

  for (let i = 0; i < idx.length; i += 3) {
    const p0 = pts[idx[i]], p1 = pts[idx[i + 1]], p2 = pts[idx[i + 2]]
    const c0 = sampleColor(ctx, clamp(p0.x, 0, w - 1), clamp(p0.y, 0, h - 1))
    const c1 = sampleColor(ctx, clamp(p1.x, 0, w - 1), clamp(p1.y, 0, h - 1))
    const c2 = sampleColor(ctx, clamp(p2.x, 0, w - 1), clamp(p2.y, 0, h - 1))

    const centroid = { x: (p0.x + p1.x + p2.x) / 3, y: (p0.y + p1.y + p2.y) / 3 }
    const area = Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2

    const rgb0 = parseRGB(c0), rgb1 = parseRGB(c1), rgb2 = parseRGB(c2)
    const avg = blendColors([rgb0, rgb1, rgb2])
    const variance = (colorDistance(rgb0, avg) + colorDistance(rgb1, avg) + colorDistance(rgb2, avg)) / 3

    result.push({
      points: [
        { x: p0.x, y: p0.y, color: c0 },
        { x: p1.x, y: p1.y, color: c1 },
        { x: p2.x, y: p2.y, color: c2 },
      ],
      centroid, area, colorVariance: variance,
    })
  }

  return filterSmallTriangles(result)
}

// Cull micro triangles to reduce speckles
function filterSmallTriangles(tris: Triangle[]): Triangle[] {
  if (!tris.length) return tris
  const areas = tris.map(t => t.area).sort((a, b) => a - b)
  const median = areas[Math.floor(areas.length / 2)] || 1
  const cut = median * 0.28 // keep triangles >= 28% of median area
  return tris.filter(t => t.area >= cut)
}

// ============ Shape Classification ============

/**
 * Classify triangles into primary (smooth-gradient areas) and detail (high-contrast areas).
 * Slightly stricter criteria reduce pepper in the primary layer.
 */
function classifyShapes(tris: Triangle[], threshold: number): { primary: Triangle[]; detail: Triangle[] } {
  const avgArea = tris.reduce((s, t) => s + t.area, 0) / tris.length

  // Build edge-based adjacency
  const edgeKey = (x1: number, y1: number, x2: number, y2: number) => {
    const a = `${x1.toFixed(1)},${y1.toFixed(1)}`
    const b = `${x2.toFixed(1)},${y2.toFixed(1)}`
    return a < b ? `${a}-${b}` : `${b}-${a}`
  }

  const neighbors: Map<number, number[]> = new Map()
  const edgeMap: Map<string, number[]> = new Map()

  for (let i = 0; i < tris.length; i++) {
    neighbors.set(i, [])
    const t = tris[i]
    const edges = [
      edgeKey(t.points[0].x, t.points[0].y, t.points[1].x, t.points[1].y),
      edgeKey(t.points[1].x, t.points[1].y, t.points[2].x, t.points[2].y),
      edgeKey(t.points[2].x, t.points[2].y, t.points[0].x, t.points[0].y),
    ]
    for (const e of edges) {
      if (!edgeMap.has(e)) edgeMap.set(e, [])
      edgeMap.get(e)!.push(i)
    }
  }
  for (const [, indices] of edgeMap) {
    if (indices.length === 2) {
      neighbors.get(indices[0])!.push(indices[1])
      neighbors.get(indices[1])!.push(indices[0])
    }
  }

  const primary: Triangle[] = []
  const detail: Triangle[] = []

  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]
    const nb = neighbors.get(i) || []
    const avgC = blendColors(t.points.map(p => parseRGB(p.color)))
    let similarCount = 0
    for (const ni of nb) {
      const nAvg = blendColors(tris[ni].points.map(p => parseRGB(p.color)))
      if (colorDistance(avgC, nAvg) / 441.67 < threshold) similarCount++ // 441.67 = max RGB distance
    }

    // Stricter: require a bit larger area and at least 2 similar neighbors
    if (t.area >= avgArea * 0.55 && similarCount >= 2) {
      primary.push(t)
    } else {
      detail.push(t)
    }
  }
  return { primary, detail }
}

// ============ Global Gradient Direction ============

function computeGlobalDir(tris: Triangle[]): { dx: number; dy: number } {
  let tdx = 0, tdy = 0, cnt = 0
  for (const t of tris) {
    const lums = t.points.map(p => getLuminance(parseRGB(p.color)))
    let minI = 0, maxI = 0
    for (let i = 1; i < 3; i++) { if (lums[i] < lums[minI]) minI = i; if (lums[i] > lums[maxI]) maxI = i }
    tdx += t.points[maxI].x - t.points[minI].x
    tdy += t.points[maxI].y - t.points[minI].y
    cnt++
  }
  if (!cnt) return { dx: 1, dy: 0 }
  const len = Math.sqrt(tdx * tdx + tdy * tdy) || 1
  return { dx: tdx / len, dy: tdy / len }
}

// ============ Path Smoothing ============

function chaikinSmooth(pts: Array<{ x: number; y: number }>, iters: number): Array<{ x: number; y: number }> {
  if (iters <= 0) return pts
  let r = [...pts]
  for (let it = 0; it < iters; it++) {
    const np: Array<{ x: number; y: number }> = []
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length]
      np.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y })
      np.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y })
    }
    r = np
  }
  return r
}

function bezierPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 3) {
    return pts.map((p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)).join(" ") + " Z"
  }
  const n = pts.length
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
    const t = 6
    d += ` C ${(p1.x + (p2.x - p0.x) / t).toFixed(2)} ${(p1.y + (p2.y - p0.y) / t).toFixed(2)}, ${(p2.x - (p3.x - p1.x) / t).toFixed(2)} ${(p2.y - (p3.y - p1.y) / t).toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d + " Z"
}

function expandFromCentroid(pts: Array<{ x: number; y: number }>, cx: number, cy: number, factor: number) {
  return pts.map(p => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }))
}

function trianglePath(tri: Triangle, settings: MoodSettings): string {
  let base = tri.points.map(p => ({ x: p.x, y: p.y }))
  if (settings.overlapAmount > 1) base = expandFromCentroid(base, tri.centroid.x, tri.centroid.y, settings.overlapAmount)
  if (settings.pathSmoothing === 0) {
    return `M ${base[0].x.toFixed(2)} ${base[0].y.toFixed(2)} L ${base[1].x.toFixed(2)} ${base[1].y.toFixed(2)} L ${base[2].x.toFixed(2)} ${base[2].y.toFixed(2)} Z`
  }
  return bezierPath(chaikinSmooth(base, settings.pathSmoothing))
}

// ============ SVG Gradient Definitions ============

function baseGradientDef(bg: BaseGradient, w: number, h: number): string {
  const { colors, direction: dir } = bg
  // Project samples along gradient direction, pick 5 evenly-spaced stops
  const sorted = [...colors].sort((a, b) => {
    return (a.position.x * dir.x2 + a.position.y * dir.y2) - (b.position.x * dir.x2 + b.position.y * dir.y2)
  })
  const count = Math.min(sorted.length, 5)
  const step = Math.floor(sorted.length / count)
  const stops = Array.from({ length: count }, (_, i) => {
    const idx = Math.min(i * step, sorted.length - 1)
    return { offset: i / (count - 1), hex: rgbObjToHex(sorted[idx].color) }
  })

  return `<linearGradient id="base-gradient" x1="${(dir.x1 * 100).toFixed(1)}%" y1="${(dir.y1 * 100).toFixed(1)}%" x2="${(dir.x2 * 100).toFixed(1)}%" y2="${(dir.y2 * 100).toFixed(1)}%">
      ${stops.map(s => `<stop offset="${(s.offset * 100).toFixed(1)}%" stop-color="${s.hex}" />`).join("\n      ")}
    </linearGradient>`
}

// Linear gradient (kept for detail shapes)
function shapeGradientDef(
  tri: Triangle,
  id: string,
  gDir: { dx: number; dy: number },
  consistency: number,
  ctx?: CanvasRenderingContext2D,
  w?: number,
  h?: number
): string {
  const colors: Array<{ x: number; y: number; hex: string }> = tri.points.map(p => ({
    x: p.x, y: p.y, hex: rgbToHex(p.color),
  }))

  if (ctx && w && h) {
    const cx = clamp(tri.centroid.x, 0, w - 1)
    const cy = clamp(tri.centroid.y, 0, h - 1)
    const c = sampleRGB(ctx, cx, cy)
    colors.push({ x: cx, y: cy, hex: rgbObjToHex(c) })
  }

  colors.sort((a, b) => (a.x * gDir.dx + a.y * gDir.dy) - (b.x * gDir.dx + b.y * gDir.dy))

  const x1 = (50 - gDir.dx * 50 * consistency).toFixed(1)
  const y1 = (50 - gDir.dy * 50 * consistency).toFixed(1)
  const x2 = (50 + gDir.dx * 50 * consistency).toFixed(1)
  const y2 = (50 + gDir.dy * 50 * consistency).toFixed(1)

  const stops = colors.map((c, i) => {
    const offset = (i / (colors.length - 1)) * 100
    return `<stop offset="${offset.toFixed(1)}%" stop-color="${c.hex}" />`
  }).join("\n        ")

  return `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
        ${stops}
      </linearGradient>`
}

// Radial gradient for primary shapes (smoother, less faceted)
function shapeRadialDef(
  tri: Triangle,
  id: string,
  ctx?: CanvasRenderingContext2D,
  w?: number,
  h?: number
): string {
  const cx = tri.centroid.x, cy = tri.centroid.y
  const r = 1.15 * Math.max(...tri.points.map(p => Math.hypot(p.x - cx, p.y - cy)))

  const centerRGB = ctx && w && h
    ? sampleRGB(ctx, clamp(cx, 0, w - 1), clamp(cy, 0, h - 1))
    : blendColors(tri.points.map(p => parseRGB(p.color)))
  const edgeRGB = blendColors(tri.points.map(p => parseRGB(p.color)))

  const cHex = rgbObjToHex(centerRGB)
  const eHex = rgbObjToHex(edgeRGB)

  return `
    <radialGradient id="${id}" cx="${(cx / (w || 1) * 100).toFixed(2)}%" cy="${(cy / (h || 1) * 100).toFixed(2)}%" r="${r.toFixed(2)}">
      <stop offset="0%" stop-color="${cHex}" />
      <stop offset="100%" stop-color="${eHex}" />
    </radialGradient>
  `
}

/**
 * Generate the final designer-quality SVG with 3 organized layers:
 *   1. Base Gradient Layer
 *   2. Primary Shapes (radial fills)
 *   3. Detail Shapes (linear fills)
 */
export function generateDesignerSVG(
  tris: Triangle[],
  w: number,
  h: number,
  mood: number,
  ctx?: CanvasRenderingContext2D,
): string {
  const settings = moodToSettings(mood)
  const gDir = computeGlobalDir(tris)
  const { primary, detail } = classifyShapes(tris, settings.mergeThreshold)

  // Build base gradient
  let baseDef = ""
  if (ctx) {
    const bg = analyzeBaseGradient(ctx, w, h)
    baseDef = baseGradientDef(bg, w, h)
  }

  // Primary (radial)
  const pGrads: string[] = []
  const pPaths: string[] = []
  primary.forEach((tri, i) => {
    const id = `pg-${i}`
    pGrads.push(shapeRadialDef(tri, id, ctx, w, h))
    pPaths.push(`<path d="${trianglePath(tri, settings)}" fill="url(#${id})" opacity="${settings.shapeOpacity.toFixed(2)}" />`)
  })

  // Detail (linear)
  const dGrads: string[] = []
  const dPaths: string[] = []
  detail.forEach((tri, i) => {
    const id = `dg-${i}`
    dGrads.push(shapeGradientDef(tri, id, gDir, settings.gradientConsistency, ctx, w, h))
    dPaths.push(`<path d="${trianglePath(tri, settings)}" fill="url(#${id})" opacity="${(settings.shapeOpacity * 0.88).toFixed(2)}" />`)
  })

  const baseOpacity = settings.baseGradientOpacity.toFixed(2)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    ${baseDef}
    ${pGrads.join("\n    ")}
    ${dGrads.join("\n    ")}
  </defs>

  <!-- Base Gradient Layer -->
  <g id="Base-Gradient">
    ${baseDef ? `<rect width="${w}" height="${h}" fill="url(#base-gradient)" opacity="${baseOpacity}" />` : ""}
  </g>

  <!-- Primary Shapes Layer -->
  <g id="Primary-Shapes">
    ${pPaths.join("\n    ")}
  </g>

  <!-- Detail Shapes Layer -->
  <g id="Detail-Shapes">
    ${dPaths.join("\n    ")}
  </g>
</svg>`
}

// ============ Canvas Preview Helpers ============
// Exported so PreviewCanvas can render the same layered result on <canvas>

export { chaikinSmooth, expandFromCentroid, computeGlobalDir, classifyShapes, blendColors, getLuminance }
