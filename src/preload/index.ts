import { contextBridge, ipcRenderer } from 'electron'

export interface StampData {
  path: string
  name: string
  data: string
  mimeType: string
}

export interface DocumentData {
  path: string
  name: string
  ext: string
  size: number
  data: string
}

export interface WordParseResult {
  html?: string
  warnings?: any[]
  error?: string
}

export interface ExcelParseResult {
  html?: string
  sheetCount?: number
  error?: string
}

export interface PdfPageCountResult {
  pageCount?: number
  error?: string
}

export interface ExcelToPdfResult {
  pdfData?: string
  pageCount?: number
  error?: string
}

export interface StampExportItem {
  imageBase64: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  pageIndex: number
  rotation: number
}

export interface ExportResult {
  data?: string
  error?: string
}

export interface SaveFileResult {
  success: boolean
  path?: string
  error?: string
}

export interface FileReadResult {
  path?: string
  name?: string
  ext?: string
  size?: number
  data?: string
  error?: string
}

const api = {
  // 文件对话框
  openStamp: (): Promise<StampData | null> =>
    ipcRenderer.invoke('dialog:openStamp'),

  openDocument: (): Promise<DocumentData | null> =>
    ipcRenderer.invoke('dialog:openDocument'),

  // 文档解析
  parseWord: (base64Data: string): Promise<WordParseResult> =>
    ipcRenderer.invoke('document:parseWord', base64Data),

  parseExcel: (base64Data: string): Promise<ExcelParseResult> =>
    ipcRenderer.invoke('document:parseExcel', base64Data),

  excelToPdf: (base64Data: string): Promise<ExcelToPdfResult> =>
    ipcRenderer.invoke('document:excelToPdf', base64Data),

  getPdfPageCount: (base64Data: string): Promise<PdfPageCountResult> =>
    ipcRenderer.invoke('document:getPdfPageCount', base64Data),

  // 导出
  stampPdf: (docBase64: string, stamps: StampExportItem[]): Promise<ExportResult> =>
    ipcRenderer.invoke('export:stampPdf', docBase64, stamps),

  saveFile: (base64Data: string, defaultName: string, filters: Array<{ name: string; extensions: string[] }>): Promise<SaveFileResult> =>
    ipcRenderer.invoke('dialog:saveFile', base64Data, defaultName, filters),

  // 按路径读取文件（用于拖拽导入）
  readFileByPath: (filePath: string): Promise<FileReadResult> =>
    ipcRenderer.invoke('file:readByPath', filePath)
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
