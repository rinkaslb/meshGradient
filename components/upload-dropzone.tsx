"use client"

import React from "react"

import { useCallback } from "react"
import { Upload, ImageIcon, FileType } from "lucide-react"
import { cn } from "@/lib/utils"

interface UploadDropzoneProps {
  onFileSelect: (file: File) => void
  isProcessing: boolean
}

export function UploadDropzone({ onFileSelect, isProcessing }: UploadDropzoneProps) {
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()

      if (isProcessing) return

      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        const file = files[0]
        if (isValidFile(file)) {
          onFileSelect(file)
        }
      }
    },
    [onFileSelect, isProcessing]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        const file = files[0]
        if (isValidFile(file)) {
          onFileSelect(file)
        }
      }
    },
    [onFileSelect]
  )

  const isValidFile = (file: File): boolean => {
    const validTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/svg+xml",
      "application/postscript", // .ai files
      "image/webp",
    ]
    // Also check file extension for .ai files
    const validExtensions = [".png", ".jpg", ".jpeg", ".svg", ".ai", ".webp"]
    const hasValidExtension = validExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    )
    return validTypes.includes(file.type) || hasValidExtension
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={cn(
        "relative border-2 border-dashed rounded-xl p-12 transition-all duration-200",
        "hover:border-foreground/40 hover:bg-muted/50",
        "border-muted-foreground/25 bg-muted/20",
        isProcessing && "opacity-50 pointer-events-none"
      )}
    >
      <input
        type="file"
        accept=".png,.jpg,.jpeg,.svg,.ai,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={isProcessing}
      />
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="p-4 rounded-full bg-muted">
          <Upload className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <p className="text-lg font-medium text-foreground">
            Drop your artwork here
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            or click to browse
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ImageIcon className="w-3.5 h-3.5" />
            PNG, JPG, WebP
          </span>
          <span className="flex items-center gap-1">
            <FileType className="w-3.5 h-3.5" />
            SVG, AI
          </span>
        </div>
      </div>
    </div>
  )
}
