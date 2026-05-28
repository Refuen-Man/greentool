export interface StampItem {
  id: string
  name: string
  dataUrl: string
  imageBase64: string
  mimeType: string
  originalWidth: number
  originalHeight: number
}

export interface StampOnCanvas {
  id: string
  stampId: string
  x: number
  y: number
  scaleX: number
  scaleY: number
  width: number
  height: number
  opacity: number
  angle: number
  pageIndex: number
  isCrossPage: boolean
}

export interface DocumentInfo {
  path: string
  name: string
  ext: string
  size: number
  data: string // base64
  type: 'pdf' | 'word' | 'image' | 'excel'
  pageCount: number
}

export type AppView = 'welcome' | 'editor' | 'export'

export interface ExportSettings {
  format: 'pdf' | 'png' | 'jpg'
  quality: number
  allPages: boolean
}
