"use client"

import { useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { UploadDropzone } from "./upload-dropzone"
import { PreviewCanvas } from "./preview-canvas"
import {
  Triangle,
  adaptivePoissonSampling,
  addBoundaryPoints,
  triangulate,
  generateDesignerSVG,
  moodToMinDistance,
  moodToSettings,
} from "@/lib/mesh-gradient"
import {
  Download,
  RefreshCw,
  Layers,
  ArrowRight,
  Trash2,
  Sparkles,
  Blend,
} from "lucide-react"

export function MeshVectorizer() {
  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [triangles, setTriangles] = useState<Triangle[]>([])
  const [mood, setMood] = useState(50)
  const [isProcessing, setIsProcessing] = useState(false)
  const [svgOutput, setSvgOutput] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const processImage = useCallback(async (imageSrc: string, currentMood: number) => {
    setIsProcessing(true)

    const img = new Image()
    img.crossOrigin = "anonymous"
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
      img.src = imageSrc
    })

    const { width, height } = img
    setImageSize({ width, height })

    const offscreen = document.createElement("canvas")
    offscreen.width = width
    offscreen.height = height
    const ctx = offscreen.getContext("2d", { willReadFrequently: true })
    if (!ctx) { setIsProcessing(false); return }
    ctx.drawImage(img, 0, 0)

    const settings = moodToSettings(currentMood)
    const minDist = moodToMinDistance(currentMood, width, height)
    let pts = adaptivePoissonSampling(ctx, width, height, minDist, settings)
    pts = addBoundaryPoints(pts, width, height, minDist)

    const newTriangles = triangulate(ctx, pts, width, height)
    setTriangles(newTriangles)

    const svg = generateDesignerSVG(newTriangles, width, height, currentMood, ctx)
    setSvgOutput(svg)
    setIsProcessing(false)
  }, [])

  const handleFileSelect = useCallback(async (file: File) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      setOriginalImage(dataUrl)
      await processImage(dataUrl, mood)
    }
    reader.readAsDataURL(file)
  }, [mood, processImage])

  const handleMoodChange = useCallback(async (value: number[]) => {
    const newMood = value[0]
    setMood(newMood)
    if (originalImage) await processImage(originalImage, newMood)
  }, [originalImage, processImage])

  const handleReprocess = useCallback(async () => {
    if (originalImage) await processImage(originalImage, mood)
  }, [originalImage, mood, processImage])

  const handleDownload = useCallback(() => {
    if (!svgOutput) return
    const blob = new Blob([svgOutput], { type: "image/svg+xml" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "mesh-gradient-vector.svg"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [svgOutput])

  const handleClear = useCallback(() => {
    setOriginalImage(null)
    setTriangles([])
    setSvgOutput(null)
    setImageSize({ width: 0, height: 0 })
    setMood(50)
  }, [])

  const getMoodLabel = (v: number) => {
    if (v < 20) return "Structured"
    if (v < 40) return "Graphic"
    if (v < 60) return "Balanced"
    if (v < 80) return "Smooth"
    return "Organic"
  }

  const getMoodDescription = (v: number) => {
    if (v < 20) return "Sharp contrast, defined shapes"
    if (v < 40) return "Clear boundaries, graphic feel"
    if (v < 60) return "Natural blend of detail and flow"
    if (v < 80) return "Soft transitions, gentle curves"
    return "Fluid gradients, minimal edges"
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-sm">
          <Sparkles className="w-4 h-4" />
          <span>Designer-Quality Vector Gradients</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-balance">
          Mesh Gradient Vectorizer
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto text-balance">
          Transform any mesh gradient into smooth, organic vector SVG.
          Export with organized layers for Figma, fully editable and lightweight.
        </p>
      </div>

      {!originalImage ? (
        <UploadDropzone onFileSelect={handleFileSelect} isProcessing={isProcessing} />
      ) : (
        <div className="space-y-6">
          {/* Controls */}
          <Card className="bg-muted/30 border-muted">
            <CardContent className="p-5">
              <div className="flex flex-col gap-5">
                {/* Mood Slider */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Blend className="w-4 h-4" />
                      Gradient Mood
                    </Label>
                    <Badge variant="secondary" className="text-xs font-medium">
                      {getMoodLabel(mood)}
                    </Badge>
                  </div>
                  <Slider
                    value={[mood]}
                    onValueChange={handleMoodChange}
                    min={0}
                    max={100}
                    step={1}
                    disabled={isProcessing}
                    className="w-full"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Structured</span>
                    <span className="text-xs text-muted-foreground/80 text-center flex-1">
                      {getMoodDescription(mood)}
                    </span>
                    <span className="text-xs text-muted-foreground">Organic</span>
                  </div>
                </div>

                {/* Stats and Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{triangles.length} shapes</span>
                    <span className="text-border">|</span>
                    <span>3 layers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleReprocess} disabled={isProcessing}>
                      <RefreshCw className={`w-4 h-4 mr-2 ${isProcessing ? "animate-spin" : ""}`} />
                      Regenerate
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleClear} disabled={isProcessing}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Clear
                    </Button>
                    <Button size="sm" onClick={handleDownload} disabled={!svgOutput || isProcessing}>
                      <Download className="w-4 h-4 mr-2" />
                      Download SVG
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Before / After */}
          <div className="grid md:grid-cols-2 gap-6 relative">
            {/* Original */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Original
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {imageSize.width} x {imageSize.height}
                  </Badge>
                </div>
                <div className="p-4 bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#fff_0%_50%)] dark:bg-[repeating-conic-gradient(#374151_0%_25%,#1f2937_0%_50%)] bg-[length:20px_20px] flex items-center justify-center min-h-[300px]">
                  <img
                    src={originalImage || "/placeholder.svg"}
                    alt="Original artwork"
                    className="max-w-full max-h-[400px] rounded-lg shadow-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Arrow */}
            <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <div className="p-2 rounded-full bg-background border shadow-sm">
                <ArrowRight className="w-5 h-5" />
              </div>
            </div>

            {/* Vectorized */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Vectorized
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {triangles.length} paths
                  </Badge>
                </div>
                <div className="p-4 bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#fff_0%_50%)] dark:bg-[repeating-conic-gradient(#374151_0%_25%,#1f2937_0%_50%)] bg-[length:20px_20px] flex items-center justify-center min-h-[300px]">
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                      <span className="text-sm">Processing...</span>
                    </div>
                  ) : triangles.length > 0 ? (
                    <PreviewCanvas
                      triangles={triangles}
                      width={imageSize.width}
                      height={imageSize.height}
                      mood={mood}
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Footer */}
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              SVG exported with organized layers: Base Gradient, Primary Shapes, Detail Shapes
            </p>
            <p className="text-xs text-muted-foreground/70">
              Fully editable in Figma, Illustrator, Sketch. Add noise overlays in your design tool for extra texture.
            </p>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
