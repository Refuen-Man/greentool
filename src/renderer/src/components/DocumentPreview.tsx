import { useState, useEffect, useRef } from 'react'
import { Spin } from 'antd'
import { FilePdfOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import { PDF_RENDER_SCALE, A4_PORTRAIT_WIDTH, A4_PORTRAIT_HEIGHT, A4_LANDSCAPE_WIDTH, A4_LANDSCAPE_HEIGHT } from '../constants'

// PDF.js - legacy ESM 构建 + Vite ?url 导入 worker
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

export default function DocumentPreview() {
  const {
    document, currentPage, setDocumentNaturalSize,
    documentDisplayWidth, documentDisplayHeight,
    a4Landscape, setDocumentPageCount
  } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [imageUrl, setImageUrl] = useState<string>('')
  const [wordHtml, setWordHtml] = useState<string>('')
  const [excelHtml, setExcelHtml] = useState<string>('')
  // 此 canvas 同时用于 PDF 渲染（renderPdfPage）和作为隐藏渲染目标
  const renderCanvasRef = useRef<HTMLCanvasElement>(null)
  // 追踪已挂载状态
  const mountedRef = useRef(true)
  // 缓存 PDF 文档实例，避免每次切页重新打开
  const pdfDocRef = useRef<any>(null)
  const pdfDataRef = useRef<string>('')
  // 缓存 Word/Excel 解析后的 HTML（避免切页时重复解析）
  const wordContentRef = useRef('')
  const excelContentRef = useRef('')
  // 追踪上一个文档路径，用于检测文档切换
  const lastDocPathRef = useRef('')
  // Word 内容容器引用（用于测量总高度）
  const wordMeasureRef = useRef<HTMLDivElement>(null)
  // Excel 内容容器引用
  const excelMeasureRef = useRef<HTMLDivElement>(null)
  // Excel 页边距（来自 XLSX !margins，单位英寸）
  const excelMarginsRef = useRef<any>(null)
  // Excel 页面设置（orientation 等）
  const excelPageSetupRef = useRef<{ orientation?: string } | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // 清理缓存的 PDF 文档
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy()
        pdfDocRef.current = null
        pdfDataRef.current = ''
      }
    }
  }, [])

  useEffect(() => {
    if (!document) return

    // 检测文档是否切换（通过路径判断）
    const isNewDoc = document.path !== lastDocPathRef.current
    if (isNewDoc) {
      lastDocPathRef.current = document.path
      wordContentRef.current = ''
      excelContentRef.current = ''
      pdfDocRef.current?.destroy()
      pdfDocRef.current = null
      pdfDataRef.current = ''
      loadDocument()
      return
    }

    // 同一文档，仅页码变化
    if (document.type === 'pdf') {
      // PDF：重新渲染当前页
      if (pdfDocRef.current) {
        renderPdfPage(document.data, currentPage)
      }
    }
    // Word/Excel：不需要重新解析，React 会用新的 currentPage 重新渲染 translateY
  }, [document, currentPage])

  // Word/Excel 渲染后测量内容高度并设置 A4 分页
  useEffect(() => {
    const measureAndSetPages = (
      ref: React.RefObject<HTMLDivElement | null>,
      pageW: number,
      pageH: number
    ) => {
      const el = ref.current
      if (!el) return
      requestAnimationFrame(() => {
        const totalHeight = el.scrollHeight
        const pageCount = Math.max(1, Math.ceil(totalHeight / pageH))
        setDocumentNaturalSize(pageW, pageH)
        setDocumentPageCount(pageCount)
      })
    }

    if (wordHtml) {
      const pw = a4Landscape ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH
      const ph = a4Landscape ? A4_LANDSCAPE_HEIGHT : A4_PORTRAIT_HEIGHT
      measureAndSetPages(wordMeasureRef, pw, ph)
    } else if (excelHtml) {
      const pw = a4Landscape ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH
      const ph = a4Landscape ? A4_LANDSCAPE_HEIGHT : A4_PORTRAIT_HEIGHT
      measureAndSetPages(excelMeasureRef, pw, ph)
    }
  }, [wordHtml, excelHtml, a4Landscape])

  const loadDocument = async () => {
    if (!document) return

    // 数据校验：base64 数据必须存在
    if (!document.data || typeof document.data !== 'string' || document.data.length === 0) {
      setError('文件数据读取失败，请重新导入文档')
      return
    }

    setLoading(true)
    setImageUrl('')
    setWordHtml('')
    setExcelHtml('')
    setError('')

    // Word 文档直接设定 A4 尺寸，不等待 measure（避免 canvas-wrapper 尺寸为 0）
    // Excel 方向由页面设置决定，稍后在 renderExcel 中设置
    if (document.type === 'word') {
      const pw = a4Landscape ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH
      const ph = a4Landscape ? A4_LANDSCAPE_HEIGHT : A4_PORTRAIT_HEIGHT
      setDocumentNaturalSize(pw, ph)
    }

    try {
      if (document.type === 'pdf') {
        await renderPdfPage(document.data, currentPage)
      } else if (document.type === 'word') {
        // 区分 .doc 和 .docx
        if (document.ext === 'doc') {
          setError('旧版 .doc 格式不支持，请使用 Microsoft Word 将文件另存为 .docx 格式后再导入。')
          return
        }
        if (wordContentRef.current) {
          setWordHtml(wordContentRef.current)
        } else {
          await renderWord(document.data)
        }
      } else if (document.type === 'excel') {
        if (excelContentRef.current) {
          setExcelHtml(excelContentRef.current)
        } else {
          await renderExcel(document.data)
        }
      } else if (document.type === 'image') {
        const dataUrl = `data:image/${document.ext === 'jpg' || document.ext === 'jpeg' ? 'jpeg' : 'png'};base64,${document.data}`
        setImageUrl(dataUrl)
        const img = new Image()
        img.onload = () => {
          if (mountedRef.current) {
            setDocumentNaturalSize(img.naturalWidth, img.naturalHeight)
          }
        }
        img.src = dataUrl
      }
    } catch (err) {
      console.error('文档加载失败:', err)
      setError(err instanceof Error ? err.message : '文档加载失败')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }

  const renderPdfPage = async (base64Data: string, pageNum: number) => {
    // 如果 base64 数据变了（切换了文档），清除缓存
    if (pdfDataRef.current !== base64Data) {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy()
        pdfDocRef.current = null
      }
      pdfDataRef.current = base64Data
    }

    // 复用以打开的 PDF 文档，或新打开
    let pdf: any
    if (pdfDocRef.current) {
      pdf = pdfDocRef.current
    } else {
      const binaryData = atob(base64Data)
      const bytes = new Uint8Array(binaryData.length)
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i)
      }
      try {
        pdf = await pdfjsLib.getDocument({
          data: bytes,
          disableAutoFetch: true,
          disableStream: true,
          verbosity: 0
        }).promise
      } catch (e: any) {
        console.error('PDF 解析失败:', e)
        throw new Error('PDF 文件解析失败，请确认文件未损坏: ' + (e.message || ''))
      }
      pdfDocRef.current = pdf
    }

    const page = await pdf.getPage(pageNum + 1)
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })

    const canvas = renderCanvasRef.current
    if (!canvas) return

    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!

    await page.render({ canvasContext: ctx, viewport }).promise
    const dataUrl = canvas.toDataURL()
    
    // 通知 store 当前文档渲染尺寸（用于坐标转换）
    setDocumentNaturalSize(viewport.width, viewport.height)
    
    if (mountedRef.current) {
      setImageUrl(dataUrl)
    }
  }

  const renderWord = async (base64Data: string) => {
    const result = await window.electronAPI.parseWord(base64Data)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.html) {
      wordContentRef.current = result.html
      setWordHtml(result.html)
    }
  }

  const renderExcel = async (base64Data: string) => {
    const result = await window.electronAPI.parseExcel(base64Data)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.html) {
      excelContentRef.current = result.html
      excelMarginsRef.current = result.margins || null
      excelPageSetupRef.current = result.pageSetup || null

      // 根据 Excel 页面设置自动切换横/竖版
      const store = useAppStore.getState()
      const orientation = result.pageSetup?.orientation
      if (orientation === 'landscape' && !store.a4Landscape) {
        store.setA4Landscape(true)
      } else if (orientation === 'portrait' && store.a4Landscape) {
        store.setA4Landscape(false)
      }
      // 设定正确的 A4 尺寸
      const ls = orientation === 'landscape' || store.a4Landscape
      const pw = ls ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH
      const ph = ls ? A4_LANDSCAPE_HEIGHT : A4_PORTRAIT_HEIGHT
      setDocumentNaturalSize(pw, ph)

      setExcelHtml(result.html)
    }
  }

  // 计算当前 A4 页面尺寸
  const pageW = a4Landscape ? A4_LANDSCAPE_WIDTH : A4_PORTRAIT_WIDTH
  const pageH = a4Landscape ? A4_LANDSCAPE_HEIGHT : A4_PORTRAIT_HEIGHT

  // 渲染内容（canvas 始终在 DOM 中以支持 PDF 翻页重渲染）
  return (
    <>
      <canvas ref={renderCanvasRef} style={{ display: 'none' }} />

      {loading || error ? (
        <div style={{
          width: 800, minHeight: 600, display: 'flex',
          flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', background: '#fff',
          gap: 12, padding: 40
        }}>
          {loading ? (
            <Spin tip="加载文档中..." />
          ) : (
            <>
              <FilePdfOutlined style={{ fontSize: 48, color: '#ef4444' }} />
              <span style={{ color: '#ef4444', fontWeight: 500 }}>文档加载失败</span>
              <span style={{ color: '#64748b', fontSize: 13, textAlign: 'center', maxWidth: 500 }}>
                {error}
              </span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                {document?.type === 'word'
                  ? '提示：Word 文档仅支持 .docx 格式，不支持旧版 .doc 格式'
                  : document?.type === 'excel'
                    ? '提示：请确认文件为 .xlsx 或 .xls 格式，且未被加密保护'
                    : document?.type === 'pdf'
                      ? '提示：请确认 PDF 文件未损坏且未被加密'
                      : '提示：请导入 PDF、Word (.docx)、Excel (.xlsx/.xls) 或图片文件'
                }
              </span>
            </>
          )}
        </div>
      ) : excelHtml ? (
        <>
          <style>{`
            .excel-preview-container table {
              border-collapse: collapse;
            }
          `}</style>
          <div style={{
            width: pageW, height: pageH,
            overflow: 'hidden',
            background: '#fff',
            position: 'relative'
          }}>
            <div
              ref={excelMeasureRef}
              className="excel-preview-container"
              style={{
                width: pageW,
                padding: 20,
                transform: `translateY(-${currentPage * pageH}px)`
              }}
              dangerouslySetInnerHTML={{ __html: excelHtml }}
            />
          </div>
        </>
      ) : wordHtml ? (
        <div style={{
          width: pageW, height: pageH,
          overflow: 'hidden',
          background: '#fff',
          position: 'relative'
        }}>
          <div
            ref={wordMeasureRef}
            className="word-preview-container"
            style={{
              width: pageW,
              padding: 40,
              fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
              fontSize: 14, lineHeight: 1.8, color: '#1e293b',
              transform: `translateY(-${currentPage * pageH}px)`
            }}
            dangerouslySetInnerHTML={{ __html: wordHtml }}
          />
        </div>
      ) : imageUrl ? (
        <div style={{
          position: 'relative',
          background: '#fff',
          lineHeight: 0,
          width: documentDisplayWidth,
          height: documentDisplayHeight,
          overflow: 'hidden'
        }}>
          <img
            className="doc-preview-image"
            src={imageUrl}
            alt="文档预览"
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
            draggable={false}
          />
        </div>
      ) : (
        <div style={{
          width: 800, height: 600, display: 'flex',
          flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', background: '#fff',
          color: '#94a3b8', gap: 12
        }}>
          <FilePdfOutlined style={{ fontSize: 48 }} />
          <span>无法加载文档预览</span>
        </div>
      )}
    </>
  )
}
