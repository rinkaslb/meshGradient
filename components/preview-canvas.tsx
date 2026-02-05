"use client"

import { useEffect, useRef } from "react"
import {
  Triangle,
  moodToSettings,
  parseRGB,
  getLuminance,
  chaikinSmooth,
  expandFromCentroid,
  computeGlobalDir,
  classifyShapes,
} from "@/lib/mesh-gradient"

interface PreviewCanvasProps {
  triangles: Triangle[]
  width: number
  height: number
  mood: number
}

/**
 * Draw a smoothed bezier path on canvas context (mirrors SVG bezier logic)
 */
function drawBezierPath(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>) {
  if (pts.length < 3) {
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    return
  }
  const n = pts.length
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const t = 6
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / t, p1.y + (p2.y - p0.y) / t,
      p2.x - (p3.x - p1.x) / t, p2.y - (p3.y - p1.y) / t,
      p2.x, p2.y
    )
  }
}

/**
 * Draw a single triangle shape on canvas with gradient
 */
function drawShape(
  ctx: CanvasRenderingContext2D,
  tri: Triangle,
  gDir: { dx: number; dy: number },
  settings: { pathSmoothing: number; overlapAmount: number; gradientConsistency: number },
  opacity: number,
) {
  const [p0, p1, p2] = tri.points
  const { x: cx, y: cy } = tri.centroid

  // Sort vertices by projection onto global direction
  const sorted = [...tri.points].sort(
    (a, b) => (a.x * gDir.dx + a.y * gDir.dy) - (b.x * gDir.dx + b.y * gDir.dy)
  )

  // Create gradient aligned with global direction
  const gradLen = Math.max(
    Math.abs(p0.x - p1.x), Math.abs(p0.x - p2.x), Math.abs(p1.x - p2.x),
    Math.abs(p0.y - p1.y), Math.abs(p0.y - p2.y), Math.abs(p1.y - p2.y),
  ) * 0.75

  const c = settings.gradientConsistency
  const gradient = ctx.createLinearGradient(
    cx - gDir.dx * gradLen * c, cy - gDir.dy * gradLen * c,
    cx + gDir.dx * gradLen * c, cy + gDir.dy * gradLen * c,
  )
  gradient.addColorStop(0, sorted[0].color)
  gradient.addColorStop(0.5, sorted[1].color)
  gradient.addColorStop(1, sorted[2].color)

  let base = [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }]
  if (settings.overlapAmount > 1) base = expandFromCentroid(base, cx, cy, settings.overlapAmount)

  ctx.beginPath()
  if (settings.pathSmoothing === 0) {
    ctx.moveTo(base[0].x, base[0].y)
    ctx.lineTo(base[1].x, base[1].y)
    ctx.lineTo(base[2].x, base[2].y)
  } else {
    const smoothed = chaikinSmooth(base, settings.pathSmoothing)
    drawBezierPath(ctx, smoothed)
  }
  ctx.closePath()
  ctx.globalAlpha = opacity
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.globalAlpha = 1.0
}

export function PreviewCanvas({ triangles, width, height, mood }: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || triangles.length === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)
    const settings = moodToSettings(mood)
    const gDir = computeGlobalDir(triangles)
    const { primary, detail } = classifyShapes(triangles, settings.mergeThreshold)

    // --- Layer 1: Base gradient ---
    // Approximate with a simple linear gradient from lowest luminance area to highest
    const allColors = triangles.flatMap(t => t.points.map(p => ({ ...p, lum: getLuminance(parseRGB(p.color)) })))
    allColors.sort((a, b) => a.lum - b.lum)
    const darkest = allColors[0]
    const lightest = allColors[allColors.length - 1]

    if (darkest && lightest) {
      const bg = ctx.createLinearGradient(darkest.x, darkest.y, lightest.x, lightest.y)
      bg.addColorStop(0, darkest.color)
      bg.addColorStop(1, lightest.color)
      ctx.globalAlpha = settings.baseGradientOpacity
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, width, height)
      ctx.globalAlpha = 1.0
    }

    // --- Layer 2: Primary shapes ---
    for (const tri of primary) {
      drawShape(ctx, tri, gDir, settings, settings.shapeOpacity)
    }

    // --- Layer 3: Detail shapes ---
    for (const tri of detail) {
      drawShape(ctx, tri, gDir, settings, settings.shapeOpacity * 0.88)
    }
  }, [triangles, width, height, mood])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="max-w-full h-auto rounded-lg"
      style={{ maxHeight: "400px", objectFit: "contain" }}
    />
  )
}
