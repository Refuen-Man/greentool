import { create } from 'zustand'
import type { StampItem, StampOnCanvas, DocumentInfo, AppView, ExportSettings } from '../types'
import { STORAGE_KEY_STAMPS, A4_PORTRAIT_WIDTH, A4_PORTRAIT_HEIGHT, A4_LANDSCAPE_WIDTH, A4_LANDSCAPE_HEIGHT } from '../constants'

interface AppState {
  // 视图
  view: AppView
  setView: (view: AppView) => void

  // 文档
  document: DocumentInfo | null
  setDocument: (doc: DocumentInfo | null) => void
  setDocumentPageCount: (count: number) => void

  // 印章库
  stamps: StampItem[]
  addStamp: (stamp: StampItem) => void
  removeStamp: (id: string) => void
  clearStamps: () => void

  // 画布上的印章实例
  activeStampId: string | null
  setActiveStampId: (id: string | null) => void
  stampsOnCanvas: StampOnCanvas[]
  addStampToCanvas: (stamp: StampOnCanvas) => void
  updateStampOnCanvas: (id: string, updates: Partial<StampOnCanvas>) => void
  removeStampFromCanvas: (id: string) => void
  clearStampsOnCanvas: () => void

  // 当前页码
  currentPage: number
  setCurrentPage: (page: number) => void

  // 导出设置
  exportSettings: ExportSettings
  setExportSettings: (settings: Partial<ExportSettings>) => void

  // 文档渲染尺寸（用于坐标转换）
  documentDisplayWidth: number
  documentDisplayHeight: number
  documentNaturalWidth: number
  documentNaturalHeight: number
  documentScale: number
  setDocumentNaturalSize: (w: number, h: number) => void
  a4Landscape: boolean
  setA4Landscape: (landscape: boolean) => void

  // UI状态
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  zoom: number
  setZoom: (zoom: number) => void
  exportDialogVisible: boolean
  setExportDialogVisible: (visible: boolean) => void

  // 历史记录（简化撤销）
  history: StampOnCanvas[][]
  historyIndex: number
  pushHistory: (state: StampOnCanvas[]) => void
  undo: () => void
  redo: () => void

  // 骑缝章模式
  crossPageMode: boolean
  setCrossPageMode: (mode: boolean) => void
}

let stampIdCounter = 0
let canvasStampIdCounter = 0

export const useAppStore = create<AppState>((set, get) => ({
  view: 'welcome',
  setView: (view) => set({ view }),

  document: null,
  setDocument: (doc) => set({ document: doc, currentPage: 0, stampsOnCanvas: [], history: [[]], historyIndex: 0 }),
  setDocumentPageCount: (count) => set((s) => {
    const clampedPage = Math.min(s.currentPage, Math.max(0, count - 1))
    return {
      document: s.document ? { ...s.document, pageCount: count } : null,
      currentPage: clampedPage
    }
  }),

  stamps: (() => {
    // 启动时从 localStorage 恢复印章库
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STAMPS)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })(),
  addStamp: (stamp) => set((s) => {
    const newStamps = [...s.stamps, { ...stamp, id: stamp.id || `stamp_${++stampIdCounter}` }]
    // 持久化
    try { localStorage.setItem(STORAGE_KEY_STAMPS, JSON.stringify(newStamps)) } catch {}
    return { stamps: newStamps }
  }),
  removeStamp: (id) => set((s) => {
    const newStamps = s.stamps.filter((st) => st.id !== id)
    const newCanvas = s.stampsOnCanvas.filter((sc) => sc.stampId !== id)
    try { localStorage.setItem(STORAGE_KEY_STAMPS, JSON.stringify(newStamps)) } catch {}
    return { stamps: newStamps, stampsOnCanvas: newCanvas }
  }),
  clearStamps: () => {
    try { localStorage.removeItem(STORAGE_KEY_STAMPS) } catch {}
    set({ stamps: [], stampsOnCanvas: [], activeStampId: null })
  },

  activeStampId: null,
  setActiveStampId: (id) => set({ activeStampId: id }),

  stampsOnCanvas: [],
  addStampToCanvas: (stamp) => {
    const s = get()
    const newStamps = [...s.stampsOnCanvas, { ...stamp, id: stamp.id || `cs_${++canvasStampIdCounter}` }]
    set({ stampsOnCanvas: newStamps })
    s.pushHistory(newStamps)
  },
  updateStampOnCanvas: (id, updates) => {
    const s = get()
    const newStamps = s.stampsOnCanvas.map((sc) =>
      sc.id === id ? { ...sc, ...updates } : sc
    )
    set({ stampsOnCanvas: newStamps })
  },
  removeStampFromCanvas: (id) => {
    const s = get()
    const newStamps = s.stampsOnCanvas.filter((sc) => sc.id !== id)
    set({ stampsOnCanvas: newStamps, activeStampId: s.activeStampId === id ? null : s.activeStampId })
    s.pushHistory(newStamps)
  },
  clearStampsOnCanvas: () => set({ stampsOnCanvas: [], activeStampId: null }),

  currentPage: 0,
  setCurrentPage: (page) => set({ currentPage: page }),

  exportSettings: { format: 'pdf', quality: 90, allPages: true },
  setExportSettings: (settings) => set((s) => ({ exportSettings: { ...s.exportSettings, ...settings } })),

  documentDisplayWidth: 800,
  documentDisplayHeight: 600,
  documentNaturalWidth: 800,
  documentNaturalHeight: 600,
  documentScale: 1,
  setDocumentNaturalSize: (w, h) => {
    const s = get()
    const a4W = s.a4Landscape ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH
    const a4H = s.a4Landscape ? A4_LANDSCAPE_HEIGHT : A4_PORTRAIT_HEIGHT
    const scale = Math.min(a4W / w, a4H / h)
    set({
      documentNaturalWidth: w,
      documentNaturalHeight: h,
      documentDisplayWidth: Math.round(w * scale),
      documentDisplayHeight: Math.round(h * scale),
      documentScale: scale
    })
  },
  a4Landscape: false,
  setA4Landscape: (landscape) => {
    const s = get()
    // 切换朝向时重新计算显示尺寸
    const natW = s.documentNaturalWidth
    const natH = s.documentNaturalHeight
    const a4W = landscape ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH
    const a4H = landscape ? A4_LANDSCAPE_HEIGHT : A4_PORTRAIT_HEIGHT
    const scale = Math.min(a4W / natW, a4H / natH)
    set({
      a4Landscape: landscape,
      documentDisplayWidth: Math.round(natW * scale),
      documentDisplayHeight: Math.round(natH * scale),
      documentScale: scale
    })
  },

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  zoom: 1,
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(3, zoom)) }),
  exportDialogVisible: false,
  setExportDialogVisible: (visible) => set({ exportDialogVisible: visible }),

  history: [[]],
  historyIndex: 0,
  pushHistory: (state) => set((s) => ({
    history: [...s.history.slice(0, s.historyIndex + 1), [...state]],
    historyIndex: s.historyIndex + 1
  })),
  undo: () => {
    const s = get()
    if (s.historyIndex > 0) {
      const newIndex = s.historyIndex - 1
      set({ stampsOnCanvas: [...s.history[newIndex]], historyIndex: newIndex })
    }
  },
  redo: () => {
    const s = get()
    if (s.historyIndex < s.history.length - 1) {
      const newIndex = s.historyIndex + 1
      set({ stampsOnCanvas: [...s.history[newIndex]], historyIndex: newIndex })
    }
  },

  crossPageMode: false,
  setCrossPageMode: (mode) => set({ crossPageMode: mode })
}))
