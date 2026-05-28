import { useState } from 'react'
import { Modal, Radio, Button, message, Progress, Space } from 'antd'
import { ExportOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import { PDF_RENDER_SCALE } from '../constants'
import { PDFDocument } from 'pdf-lib'

// 按需动态加载 html2canvas（仅 Word 文档导出图片时使用）
let html2canvas: any = null
const loadHtml2canvas = async () => {
  if (!html2canvas) {
    const mod = await import('html2canvas')
    html2canvas = mod.default
  }
  return html2canvas
}

/** Uint8Array → Base64（避免 String.fromCharCode(...spread) 爆栈） */
const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  const binary = new TextDecoder('latin1').decode(bytes)
  return btoa(binary)
}

export default function ExportDialog() {
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const {
    document: docInfo, stampsOnCanvas, stamps,
    exportSettings, setExportSettings,
    exportDialogVisible, setExportDialogVisible,
    documentDisplayWidth, documentDisplayHeight,
    currentPage
  } = useAppStore()

  const handleExport = async () => {
    const state = useAppStore.getState()
    const latestDoc = state.document
    const latestFormat = state.exportSettings.format

    if (!latestDoc) return
    setExporting(true)
    setProgress(0)

    try {
      if (latestFormat === 'pdf' && latestDoc.type === 'pdf') {
        await exportAsPdf()
      } else if (latestFormat === 'pdf' && (latestDoc.type === 'word' || latestDoc.type === 'excel')) {
        await exportWordExcelAsPdf()
      } else if (latestFormat === 'pdf' && latestDoc.type === 'image') {
        await exportImageAsPdf()
      } else {
        await exportAsImage()
      }
    } catch (err: any) {
      message.error('导出失败: ' + (err.message || '未知错误'))
    } finally {
      setExporting(false)
      setProgress(0)
      setExportDialogVisible(false)
    }
  }

  const rotateStampImage = (dataUrl: string, angleDeg: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (angleDeg === 0) { resolve(dataUrl); return }
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const rad = (angleDeg * Math.PI) / 180
        const cos = Math.abs(Math.cos(rad)); const sin = Math.abs(Math.sin(rad))
        canvas.width = img.width * cos + img.height * sin
        canvas.height = img.width * sin + img.height * cos
        const ctx = canvas.getContext('2d')!
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(rad)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('印章图片加载失败'))
      img.src = dataUrl
    })
  }

  const exportAsPdf = async () => {
    const state = useAppStore.getState()
    const latestDoc = state.document
    const latestExportSettings = state.exportSettings
    const latestStampsOnCanvas = state.stampsOnCanvas
    const latestCurrentPage = state.currentPage
    if (!latestDoc) return
    setProgress(10)

    const stampsToExport = latestExportSettings.allPages
      ? latestStampsOnCanvas
      : latestStampsOnCanvas.filter((sc) => sc.pageIndex === latestCurrentPage)

    const exportStamps: Array<{
      imageBase64: string; x: number; y: number; width: number; height: number
      opacity: number; pageIndex: number; rotation: number
    }> = []

    const stampsFromStore = useAppStore.getState().stamps
    for (const sc of stampsToExport) {
      const stamp = stampsFromStore.find((s) => s.id === sc.stampId)
      if (!stamp) continue
      const ds = useAppStore.getState().documentScale || 1
      const pdfX = sc.x / PDF_RENDER_SCALE / ds
      const pdfY = sc.y / PDF_RENDER_SCALE / ds
      const pdfW = sc.width / PDF_RENDER_SCALE / ds
      const pdfH = sc.height / PDF_RENDER_SCALE / ds
      let imgData = stamp.dataUrl
      if (sc.angle !== 0) { try { imgData = await rotateStampImage(stamp.dataUrl, sc.angle) } catch {} }
      const base64Part = imgData.includes('base64,') ? imgData.split('base64,')[1] : imgData
      exportStamps.push({ imageBase64: base64Part, x: pdfX, y: pdfY, width: pdfW, height: pdfH, opacity: sc.opacity, pageIndex: sc.pageIndex, rotation: 0 })
    }

    setProgress(30)
    const result = await window.electronAPI.stampPdf(latestDoc.data, exportStamps)
    if (result.error) { message.error(result.error); return }
    setProgress(70)
    const saveResult = await window.electronAPI.saveFile(
      result.data!,
      `盖章_${latestDoc.name.replace(/\.[^.]+$/, '')}.pdf`,
      [{ name: 'PDF 文件', extensions: ['pdf'] }]
    )
    if (saveResult.success) { message.success('PDF 导出成功!') }
    else if (saveResult.error) { message.error(saveResult.error) }
    setProgress(100)
  }

  /** 图片文档导出为 PDF（用 pdf-lib 嵌入图片） */
  const exportImageAsPdf = async () => {
    const state = useAppStore.getState()
    const latestDoc = state.document
    const latestStamps = state.stamps
    const latestStampsOnCanvas = state.stampsOnCanvas
    if (!latestDoc) return
    setProgress(10)

    const docImg = window.document.querySelector('.doc-preview-image') as HTMLImageElement | null
    if (!docImg) { message.error('无法获取文档预览'); return }

    // 在 canvas 上绘制文档图片 + 印章
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = documentDisplayWidth * scale
    canvas.height = documentDisplayHeight * scale
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(docImg, 0, 0, canvas.width, canvas.height)

    setProgress(30)
    const naturalScale = 1 / (useAppStore.getState().documentScale || 1)
    await drawStampsOnCanvas(ctx, canvas.width, canvas.height,
      latestStampsOnCanvas.filter((sc: typeof stampsOnCanvas[number]) => sc.pageIndex === currentPage),
      latestStamps, scale, naturalScale, currentPage, documentDisplayWidth)

    setProgress(60)
    const pngDataUrl = canvas.toDataURL('image/png')
    const pngBase64 = pngDataUrl.split(',')[1]
    const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0))

    const pdfDoc = await PDFDocument.create()
    const embedded = await pdfDoc.embedPng(pngBytes)
    // 按图片比例创建 PDF 页面（A4 宽度为基准）
    const imgW = canvas.width; const imgH = canvas.height
    const A4_W_PT = 595
    const pageH = A4_W_PT * (imgH / imgW)
    const page = pdfDoc.addPage([A4_W_PT, pageH])
    page.drawImage(embedded, { x: 0, y: 0, width: A4_W_PT, height: pageH })

    const pdfBytes = await pdfDoc.save()
    const pdfBase64 = uint8ArrayToBase64(pdfBytes)

    setProgress(85)
    const saveResult = await window.electronAPI.saveFile(
      pdfBase64,
      `盖章_${latestDoc.name.replace(/\.[^.]+$/, '')}.pdf`,
      [{ name: 'PDF 文件', extensions: ['pdf'] }]
    )
    if (saveResult.success) { message.success('PDF 导出成功!') }
    else if (saveResult.error) { message.error(saveResult.error) }
    setProgress(100)
  }

  /** Word/Excel 导出为真正 PDF（渲染每页为图片，用 pdf-lib 合成） */
  const exportWordExcelAsPdf = async () => {
    const state = useAppStore.getState()
    const latestDoc = state.document
    const latestStamps = state.stamps
    const latestStampsOnCanvas = state.stampsOnCanvas
    const latestCurrentPage = state.currentPage
    const a4Landscape = state.a4Landscape
    if (!latestDoc) return
    setProgress(10)

    const pageW = a4Landscape ? 1123 : 794
    const pageH = a4Landscape ? 794 : 1123

    // 克隆内容元素，去除分页 transform 以捕获完整内容
    const previewSelector = latestDoc.type === 'excel' ? '.excel-preview-container' : '.word-preview-container'
    const previewEl = window.document.querySelector(previewSelector) as HTMLElement | null
    if (!previewEl) { message.error('无法获取文档预览'); return }

    const clone = previewEl.cloneNode(true) as HTMLElement
    clone.style.transform = ''
    clone.style.position = 'fixed'; clone.style.top = '-9999px'; clone.style.left = '0'
    clone.style.zIndex = '-1'; clone.style.visibility = 'visible'; clone.style.width = pageW + 'px'
    document.body.appendChild(clone)

    try {
      const h2c = await loadHtml2canvas()
      const exportScale = 2
      const fullCanvas = await h2c(clone, { backgroundColor: '#ffffff', scale: exportScale, useCORS: true, allowTaint: true })
      const totalPages = Math.max(1, Math.ceil(fullCanvas.height / (pageH * exportScale)))

      setProgress(30)

      // 创建新 PDF（A4 页面，单位：pt，1pt = 1/72 inch, A4 = 595×842 pt）
      const A4_W_PT = 595
      const A4_H_PT = 842
      const pdfDoc = await PDFDocument.create()

      for (let p = 0; p < totalPages; p++) {
        const startY = p * pageH * exportScale
        const sliceHeight = Math.min(pageH * exportScale, fullCanvas.height - startY)

        // 截取当前页内容
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = pageW * exportScale
        sliceCanvas.height = pageH * exportScale
        const sctx = sliceCanvas.getContext('2d')!
        sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
        sctx.drawImage(fullCanvas, 0, startY, sliceCanvas.width, sliceHeight, 0, 0, sliceCanvas.width, sliceHeight)

        // 绘制本页印章
        const pageStamps = latestStampsOnCanvas.filter((sc) => sc.pageIndex === p)
        await drawStampsOnCanvas(sctx, sliceCanvas.width, sliceCanvas.height, pageStamps, latestStamps, exportScale, 1, p, pageW)

        // 嵌入为 PDF 页面
        const pngDataUrl = sliceCanvas.toDataURL('image/png')
        const pngBase64 = pngDataUrl.split(',')[1]
        const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0))
        const embedded = await pdfDoc.embedPng(pngBytes)

        const page = pdfDoc.addPage([A4_W_PT, A4_H_PT])
        // 图片填满整页
        page.drawImage(embedded, { x: 0, y: 0, width: A4_W_PT, height: A4_H_PT })

        setProgress(30 + Math.round(((p + 1) / totalPages) * 50))
      }

      const pdfBytes = await pdfDoc.save()
      const pdfBase64 = uint8ArrayToBase64(pdfBytes)

      setProgress(85)
      const saveResult = await window.electronAPI.saveFile(
        pdfBase64,
        `盖章_${latestDoc.name.replace(/\.[^.]+$/, '')}.pdf`,
        [{ name: 'PDF 文件', extensions: ['pdf'] }]
      )
      if (saveResult.success) { message.success('PDF 导出成功!') }
      else if (saveResult.error) { message.error(saveResult.error) }
    } catch (err: any) {
      message.error('PDF 导出失败: ' + (err.message || '未知错误'))
    } finally {
      document.body.removeChild(clone)
    }
    setProgress(100)
  }

  const exportAsImage = async () => {
    const state = useAppStore.getState()
    const latestDoc = state.document
    const latestStamps = state.stamps
    const latestStampsOnCanvas = state.stampsOnCanvas
    const latestCurrentPage = state.currentPage
    if (!latestDoc) return
    setProgress(10)

    let exportScale = 1
    let pageW = documentDisplayWidth
    let pageH = documentDisplayHeight

    if (latestDoc.type === 'word' || latestDoc.type === 'excel') {
      const previewSelector = latestDoc.type === 'excel' ? '.excel-preview-container' : '.word-preview-container'
      const previewEl = window.document.querySelector(previewSelector) as HTMLElement | null
      if (!previewEl) { message.error('无法获取文档预览'); return }
      const a4Landscape = useAppStore.getState().a4Landscape
      pageW = a4Landscape ? 1123 : 794
      pageH = a4Landscape ? 794 : 1123

      const clone = previewEl.cloneNode(true) as HTMLElement
      clone.style.transform = ''
      clone.style.position = 'fixed'; clone.style.top = '-9999px'; clone.style.left = '0'
      clone.style.zIndex = '-1'; clone.style.visibility = 'visible'; clone.style.width = pageW + 'px'
      document.body.appendChild(clone)

      try {
        const h2c = await loadHtml2canvas()
        exportScale = 2
        const fullCanvas = await h2c(clone, { backgroundColor: '#ffffff', scale: exportScale, useCORS: true, allowTaint: true })
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = pageW * exportScale; sliceCanvas.height = pageH * exportScale
        const sctx = sliceCanvas.getContext('2d')!
        const totalPages = Math.ceil(fullCanvas.height / (pageH * exportScale))
        const startY = latestCurrentPage * pageH * exportScale
        const sliceHeight = Math.min(pageH * exportScale, fullCanvas.height - startY)
        sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
        sctx.drawImage(fullCanvas, 0, startY, sliceCanvas.width, sliceHeight, 0, 0, sliceCanvas.width, sliceHeight)
        await drawStampsOnCanvas(sctx, sliceCanvas.width, sliceCanvas.height,
          latestStampsOnCanvas.filter((sc) => sc.pageIndex === latestCurrentPage),
          latestStamps, exportScale, 1, latestCurrentPage, pageW)

        setProgress(70)
        const latestFormat = useAppStore.getState().exportSettings.format
        const ext = latestFormat === 'jpg' ? 'jpg' : 'png'
        const mimeType = ext === 'jpg' ? 'image/jpeg' : 'image/png'
        const quality = ext === 'jpg' ? (useAppStore.getState().exportSettings.quality / 100) : undefined
        const dataUrl = sliceCanvas.toDataURL(mimeType, quality)
        const base64Data = dataUrl.split(',')[1]
        const actualExt = latestFormat === 'pdf' ? 'png' : ext
        const fileLabel = actualExt.toUpperCase()
        const pageSuffix = totalPages > 1 ? `_第${latestCurrentPage + 1}页` : ''
        const saveResult = await window.electronAPI.saveFile(base64Data,
          `盖章_${latestDoc.name.replace(/\.[^.]+$/, '')}${pageSuffix}.${actualExt}`,
          [{ name: `${fileLabel} 图片`, extensions: [actualExt] }])
        if (saveResult.success) { message.success(`${fileLabel} 导出成功!`) }
        else if (saveResult.error) { message.error(saveResult.error) }
      } catch { message.error('文档渲染失败') }
      finally { document.body.removeChild(clone) }
      setProgress(100)
      return
    } else {
      const docImg = window.document.querySelector('.doc-preview-image') as HTMLImageElement | null
      if (!docImg) { message.error('无法获取文档预览，请确认文档已加载'); return }
      const baseCanvas = document.createElement('canvas')
      baseCanvas.width = documentDisplayWidth; baseCanvas.height = documentDisplayHeight
      const ctx = baseCanvas.getContext('2d')!
      ctx.drawImage(docImg, 0, 0, baseCanvas.width, baseCanvas.height)
      setProgress(40)
      const stampsToExport = latestStampsOnCanvas.filter((sc) => sc.pageIndex === latestCurrentPage)
      const naturalScale = 1 / (useAppStore.getState().documentScale || 1)
      await drawStampsOnCanvas(ctx, baseCanvas.width, baseCanvas.height, stampsToExport, latestStamps, 1, naturalScale, latestCurrentPage, documentDisplayWidth)
      setProgress(70)
      const latestFormat = useAppStore.getState().exportSettings.format
      const ext = latestFormat === 'jpg' ? 'jpg' : 'png'
      const mimeType = ext === 'jpg' ? 'image/jpeg' : 'image/png'
      const quality = ext === 'jpg' ? (useAppStore.getState().exportSettings.quality / 100) : undefined
      const dataUrl = baseCanvas.toDataURL(mimeType, quality)
      const base64Data = dataUrl.split(',')[1]
      const actualExt = latestFormat === 'pdf' ? 'png' : ext
      const fileLabel = actualExt.toUpperCase()
      const saveResult = await window.electronAPI.saveFile(base64Data,
        `盖章_${latestDoc.name.replace(/\.[^.]+$/, '')}.${actualExt}`,
        [{ name: `${fileLabel} 图片`, extensions: [actualExt] }])
      if (saveResult.success) { message.success(`${fileLabel} 导出成功!`) }
      else if (saveResult.error) { message.error(saveResult.error) }
      setProgress(100)
      return
    }
  }

  const drawStampsOnCanvas = async (
    ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number,
    stampsToDraw: typeof stampsOnCanvas, stampsLib: typeof stamps,
    exportScale: number, naturalScale: number, targetPage: number, pageW: number
  ) => {
    for (const sc of stampsToDraw) {
      const stamp = stampsLib.find((s) => s.id === sc.stampId)
      if (!stamp) continue
      try {
        const img = new Image()
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('加载印章失败')); img.src = stamp.dataUrl })
        ctx.save(); ctx.globalAlpha = sc.opacity
        const sx = sc.x * naturalScale * exportScale; const sy = sc.y * naturalScale * exportScale
        const sw = sc.width * naturalScale * exportScale; const sh = sc.height * naturalScale * exportScale
        if (sc.isCrossPage) {
          const currentPageW = pageW * naturalScale * exportScale
          ctx.beginPath(); ctx.rect(0, 0, currentPageW, canvasH); ctx.clip()
        }
        if (sc.angle !== 0) {
          const cx = sx + sw / 2; const cy = sy + sh / 2
          ctx.translate(cx, cy); ctx.rotate((sc.angle * Math.PI) / 180)
          ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh)
        } else { ctx.drawImage(img, sx, sy, sw, sh) }
        ctx.restore()
      } catch { console.warn('跳过印章:', stamp.name) }
    }
  }

  return (
    <>
      <Modal title="导出盖章文档" open={exportDialogVisible} onCancel={() => setExportDialogVisible(false)}
        footer={null} width={420} centered>
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>导出格式</div>
            <Radio.Group value={exportSettings.format}
              onChange={(e) => setExportSettings({ format: e.target.value })} disabled={exporting}>
              <Space direction="vertical" size={12}>
                <Radio value="pdf">
                  <span style={{ fontWeight: 500 }}>PDF 格式</span>
                  <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 6 }}>
                    {docInfo?.type === 'pdf' ? '直接写入PDF (推荐)' : '渲染为PDF'}
                  </span>
                </Radio>
                <Radio value="png">
                  <span style={{ fontWeight: 500 }}>PNG 图片</span>
                  <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 6 }}>无损格式</span>
                </Radio>
                <Radio value="jpg">
                  <span style={{ fontWeight: 500 }}>JPG 图片</span>
                  <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 6 }}>压缩格式</span>
                </Radio>
              </Space>
            </Radio.Group>
          </div>
          {exportSettings.format === 'pdf' && docInfo && docInfo.pageCount > 1 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>页面范围</div>
              <Radio.Group value={exportSettings.allPages ? 'all' : 'current'}
                onChange={(e) => setExportSettings({ allPages: e.target.value === 'all' })}>
                <Radio value="all">所有页面</Radio>
                <Radio value="current">仅当前页</Radio>
              </Radio.Group>
            </div>
          )}
          {exporting && (<div style={{ marginBottom: 20 }}><Progress percent={progress} size="small" /></div>)}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button onClick={() => setExportDialogVisible(false)} disabled={exporting}>取消</Button>
            <Button type="primary" icon={<ExportOutlined />} onClick={handleExport} loading={exporting}>开始导出</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}