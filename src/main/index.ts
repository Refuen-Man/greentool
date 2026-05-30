import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { PDFDocument } from 'pdf-lib'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'

let mainWindow: BrowserWindow | null = null

// PDF 转换专用隐藏窗口（单例复用）
let pdfConvertWindow: BrowserWindow | null = null

function getPdfConvertWindow(): BrowserWindow {
  if (pdfConvertWindow && !pdfConvertWindow.isDestroyed()) return pdfConvertWindow
  pdfConvertWindow = new BrowserWindow({
    width: 1200, height: 900, show: false,
    webPreferences: { sandbox: false, nodeIntegration: false }
  })
  pdfConvertWindow.on('closed', () => { pdfConvertWindow = null })
  return pdfConvertWindow
}

async function htmlToPdfBuffer(htmlBody: string, landscape: boolean): Promise<Buffer> {
  const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { margin:20px; background:#fff; font-family:Calibri,sans-serif; }
  table { border-collapse:collapse; }
</style></head><body>${htmlBody}</body></html>`
  const tmpPath = join(tmpdir(), `green-parrot-xls-${Date.now()}.html`)
  writeFileSync(tmpPath, fullHtml, 'utf-8')
  const win = getPdfConvertWindow()
  try {
    await win.loadURL(`file:///${tmpPath.replace(/\\/g, '/')}`)
    await new Promise<void>((resolve) => {
      const check = () => {
        if (win.webContents.isLoading()) { setTimeout(check, 100); return }
        setTimeout(resolve, 300)
      }
      check()
    })
    const pdfBuf = await win.webContents.printToPDF({
      printBackground: true, landscape,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    return Buffer.from(pdfBuf)
  } finally {
    try { unlinkSync(tmpPath) } catch {}
  }
}

async function getPdfPageCountFromBuffer(pdfBuffer: Buffer): Promise<number> {
  try { const d = await PDFDocument.load(pdfBuffer); return d.getPageCount() } catch { return 1 }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '绿鹦鹉工具箱',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    show: false
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ============ IPC Handlers ============

// 打开文件对话框 - 导入印章
ipcMain.handle('dialog:openStamp', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '选择印章图片',
    filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const buffer = readFileSync(filePath)
  const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
  return {
    path: filePath,
    name: filePath.split(/[/\\]/).pop() || 'stamp',
    data: buffer.toString('base64'),
    mimeType
  }
})

// 打开文件对话框 - 导入文档
ipcMain.handle('dialog:openDocument', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '选择待盖章文档',
    filters: [
      { name: '支持的文档', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'bmp', 'webp'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const buffer = readFileSync(filePath)
  return {
    path: filePath,
    name: filePath.split(/[/\\]/).pop() || 'document',
    ext,
    size: buffer.length,
    data: buffer.toString('base64')
  }
})

// 解析 Word 文档为 HTML
ipcMain.handle('document:parseWord', async (_event, base64Data: string) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    const result = await mammoth.convertToHtml({ buffer })
    return { html: result.value, warnings: result.messages }
  } catch (err: any) {
    return { error: err.message || 'Word 文档解析失败' }
  }
})

// 解析 Excel 文档为 HTML 表格（自定义渲染：完整保留原始样式）
ipcMain.handle('document:parseExcel', async (_event, base64Data: string) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true })
    const sheetNames = workbook.SheetNames

    // 仅处理第一个 sheet（默认页）
    const firstSheetName = sheetNames[0]
    const html = excelToHtml(workbook, firstSheetName)
    return { html, sheetCount: 1 }
  } catch (err: any) {
    return { error: err.message || 'Excel 文档解析失败' }
  }
})

// ============ 自定义 Excel→HTML 渲染器 ============

// Office 标准主题色基准（主题索引 0-11）
const THEME_BASE: Record<number, [number,number,number]> = {
  0: [255,255,255], 1: [0,0,0],       2: [238,236,225], 3: [31,73,125],
  4: [79,129,189],  5: [192,80,77],    6: [155,187,89],  7: [128,100,162],
  8: [75,172,198],  9: [247,150,70],   10: [0,0,255],    11: [128,0,128]
}

/** 将主题色+色调合成精确 RGB，输出 #RRGGBB */
const themeColorToRgb = (theme: number, tint: number): string => {
  const base = THEME_BASE[theme] || [0,0,0]
  if (tint === 0 || tint == null) {
    return '#' + base.map(c => c.toString(16).padStart(2,'0')).join('')
  }
  let [r,g,b] = base
  if (tint < 0) {
    // 变暗：channel ← channel*(1+tint)   (tint ∈ [-1,0))
    const f = 1 + tint
    r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f)
  } else {
    // 变亮：channel ← channel + (255-channel)*tint
    r = Math.round(r + (255 - r) * tint)
    g = Math.round(g + (255 - g) * tint)
    b = Math.round(b + (255 - b) * tint)
  }
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  return '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('')
}

/** xlsx 颜色对象 → #RRGGBB */
const xlColorToCss = (color: any): string => {
  if (!color) return ''
  // 直接 RGB / ARGB
  if (color.rgb) {
    const r = color.rgb
    return '#' + (r.length === 8 ? r.slice(2) : r)
  }
  // 主题色 + 色调
  if (color.theme !== undefined) {
    return themeColorToRgb(color.theme, color.tint ?? 0)
  }
  // 索引色
  if (color.indexed !== undefined) {
    const idx: Record<number,string> = {
      0:'#000000',1:'#FFFFFF',2:'#FF0000',3:'#00FF00',4:'#0000FF',
      5:'#FFFF00',6:'#FF00FF',7:'#00FFFF',8:'#000000',9:'#FFFFFF',
      10:'#FF0000',11:'#00FF00',12:'#0000FF',13:'#FFFF00',14:'#FF00FF',
      15:'#00FFFF',16:'#800000',17:'#008000',18:'#000080',19:'#808000',
      20:'#800080',21:'#008080',22:'#C0C0C0',23:'#808080',
      24:'#9999FF',25:'#993366',26:'#FFFFCC',27:'#CCFFFF',
      28:'#660066',29:'#FF8080',30:'#0066CC',31:'#CCCCFF',
      32:'#000080',33:'#FF00FF',34:'#FFFF00',35:'#00FFFF',
      36:'#800080',37:'#800000',38:'#008080',39:'#0000FF',
      40:'#00CCFF',41:'#CCFFFF',42:'#CCFFCC',43:'#FFFF99',
      44:'#99CCFF',45:'#FF99CC',46:'#CC99FF',47:'#FFCC99',
      48:'#3366FF',49:'#33CCCC',50:'#99CC00',51:'#FFCC00',
      52:'#FF9900',53:'#FF6600',54:'#666699',55:'#969696',
      56:'#003366',57:'#339966',58:'#003300',59:'#333300',
      60:'#993300',61:'#993366',62:'#333399',63:'#333333',
      64:'#FFFFFF',65:'#000000'
    }
    return idx[color.indexed] || '#000000'
  }
  return ''
}

/** 边框线型 → CSS */
const bdStyleToCss = (s: string): string => {
  const m: Record<string,string> = {
    thin:'1px solid',medium:'2px solid',thick:'3px solid',
    hair:'0.5px solid',dotted:'1px dotted',dashed:'1px dashed',
    double:'3px double',dashDot:'1px dashed',dashDotDot:'1px dotted',
    mediumDashed:'2px dashed',mediumDashDot:'2px dashed',
    mediumDashDotDot:'2px dotted',slantDashDot:'1px dashed'
  }
  return m[s] || '1px solid'
}

const halignMap: Record<string,string> = {
  left:'left',center:'center',right:'right',fill:'left',
  justify:'justify',centerContinuous:'center',distributed:'justify'
}
const valignMap: Record<string,string> = {
  top:'top',center:'middle',bottom:'bottom',justify:'middle',distributed:'middle'
}

function excelToHtml(workbook: XLSX.WorkBook, sheetName: string): string {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet || !sheet['!ref']) return ''

  const wb = workbook as any
  const st = wb.Styles || {}
  const cellXfs: any[] = st.CellXf || []
  const fonts: any[] = st.Fonts || []
  const fills: any[] = st.Fills || []
  const borders: any[] = st.Borders || []

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const merges: XLSX.Range[] = (sheet as any)['!merges'] || []
  const colsInfo: any[] = (sheet as any)['!cols'] || []
  const rowsInfo: any[] = (sheet as any)['!rows'] || []

  // 合并映射
  const mergeSkip = new Set<string>()
  const mergeSpan: Record<string,{cs:number;rs:number}> = {}
  for (const m of merges) {
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const k = r + ',' + c
        if (r === m.s.r && c === m.s.c) {
          mergeSpan[k] = { cs: m.e.c - m.s.c + 1, rs: m.e.r - m.s.r + 1 }
        } else {
          mergeSkip.add(k)
        }
      }
    }
  }

  // 默认字体检测：读取 fonts[0] 作为基准字体，找不到用 Calibri 11pt
  const defaultFont = (fonts?.[0]?.name || fonts?.[1]?.name) || 'Calibri'
  const defaultFontSize = (fonts?.[0]?.sz || fonts?.[1]?.sz) || 11

  // colgroup
  let colsHtml = ''
  if (colsInfo.length > 0) {
    colsHtml = '<colgroup>'
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ci = colsInfo[c]
      if (ci?.wpx) {
        colsHtml += `<col style="width:${ci.wpx}px">`
      } else if (ci?.wch) {
        // Excel 列宽字符→像素：标准约为 wch*7 + 5（含边距）
        colsHtml += `<col style="width:${Math.round(ci.wch * 7 + 5)}px">`
      } else {
        colsHtml += '<col>'
      }
    }
    colsHtml += '</colgroup>'
  }

  // ---------- 构建行 ----------
  let rowsHtml = ''
  for (let r = range.s.r; r <= range.e.r; r++) {
    const ri = rowsInfo?.[r]
    // Excel 默认行高 ~15pt ≈ 20px
    const rhAttr = ri?.hpx ? ` style="height:${ri.hpx}px"` : (ri?.hpt ? ` style="height:${Math.round(ri.hpt * 4 / 3)}px"` : '')
    rowsHtml += `<tr${rhAttr}>`

    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = r + ',' + c
      if (mergeSkip.has(key)) continue

      const cellRef = XLSX.utils.encode_cell({ r, c })
      const raw = (sheet as any)[cellRef]
      const cell: any = raw && typeof raw === 'object' ? raw : (raw != null ? { v: raw, t: 'n' } : null)

      const span = mergeSpan[key]
      const csAttr = span?.cs && span.cs > 1 ? ` colspan="${span.cs}"` : ''
      const rsAttr = span?.rs && span.rs > 1 ? ` rowspan="${span.rs}"` : ''

      const css: string[] = []

      // 基线样式（近似 Excel 默认）
      css.push(`font-family:'${defaultFont}',sans-serif`)
      css.push(`font-size:${defaultFontSize}pt`)
      css.push('padding:1px 3px')

      if (cell?.s != null && cellXfs[cell.s]) {
        const xf = cellXfs[cell.s]

        // 填充色
        if (xf.fillId != null && fills[xf.fillId]) {
          const fill = fills[xf.fillId]
          const c = fill.fgColor || fill.bgColor
          if (c) {
            const bg = xlColorToCss(c)
            if (bg) css.push('background-color:' + bg)
          }
        }

        // 字体（覆盖默认值）
        if (xf.fontId != null && fonts[xf.fontId]) {
          const f = fonts[xf.fontId]
          if (f.name) css.push("font-family:'" + f.name + "',sans-serif")
          if (f.sz) css.push('font-size:' + f.sz + 'pt')
          if (f.color) { const fc = xlColorToCss(f.color); if (fc) css.push('color:' + fc) }
          if (f.bold) css.push('font-weight:bold')
          if (f.italic) css.push('font-style:italic')
          if (f.underline) css.push('text-decoration:underline')
          if (f.strike) css.push('text-decoration:line-through')
        }

        // 对齐
        if (xf.alignment) {
          const a = xf.alignment
          if (a.horizontal && halignMap[a.horizontal]) css.push('text-align:' + halignMap[a.horizontal])
          if (a.vertical && valignMap[a.vertical]) css.push('vertical-align:' + valignMap[a.vertical])
          if (a.indent && !a.horizontal) {
            // 缩进（仅当无显式水平对齐时，默认左对齐+缩进）
            css.push('text-align:left')
            css.push('padding-left:' + (3 + a.indent * 12) + 'px')
          }
          if (a.wrapText) {
            css.push('white-space:pre-wrap;word-break:break-word')
          }
          // 不设 wrapText → 不强制 nowrap，让浏览器自然换行
        }

        // 边框
        if (xf.borderId != null && borders[xf.borderId]) {
          const bd = borders[xf.borderId]
          const bdApply = (side: string, b: any) => {
            if (!b?.style) return
            const bs = bdStyleToCss(b.style)
            const bc = xlColorToCss(b.color) || '#d4d4d4'
            css.push('border-' + side + ':' + bs + ' ' + bc)
          }
          bdApply('top', bd.top)
          bdApply('right', bd.right)
          bdApply('bottom', bd.bottom)
          bdApply('left', bd.left)
        }
      }

      const styleAttr = css.length > 0 ? ' style="' + css.join(';') + '"' : ''

      const text = cell ? (cell.w || cell.v || '') : ''
      const disp = text != null ? String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''

      const tag = r === 0 ? 'th' : 'td'
      rowsHtml += `<${tag}${styleAttr}${csAttr}${rsAttr}>${disp}</${tag}>`
    }
    rowsHtml += '</tr>'
  }

  return `<table>${colsHtml}${rowsHtml}</table>`
}

// Excel → PDF 转换（HTML 渲染后通过 printToPDF 转为真实 PDF）
ipcMain.handle('document:excelToPdf', async (_event, base64Data: string, landscape: boolean) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return { error: 'Excel 文件中没有工作表' }

    const html = excelToHtml(workbook, sheetName)
    const pdfBuffer = await htmlToPdfBuffer(html, landscape ?? true)
    const pageCount = await getPdfPageCountFromBuffer(pdfBuffer)

    return { pdfData: pdfBuffer.toString('base64'), pageCount }
  } catch (err: any) {
    return { error: err.message || 'Excel 转 PDF 失败' }
  }
})

// 获取 PDF 页数
ipcMain.handle('document:getPdfPageCount', async (_event, base64Data: string) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    const pdfDoc = await PDFDocument.load(buffer)
    return { pageCount: pdfDoc.getPageCount() }
  } catch (err: any) {
    return { error: err.message || 'PDF 读取失败' }
  }
})

// 合成盖章 PDF
ipcMain.handle('export:stampPdf', async (_event, docBase64: string, stamps: Array<{
  imageBase64: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  pageIndex: number
  rotation: number
}>) => {
  try {
    const docBuffer = Buffer.from(docBase64, 'base64')
    const pdfDoc = await PDFDocument.load(docBuffer)
    const pages = pdfDoc.getPages()

    for (const stamp of stamps) {
      if (stamp.pageIndex >= pages.length) continue
      const page = pages[stamp.pageIndex]
      const { width: pageWidth, height: pageHeight } = page.getSize()

      // 加载印章图片
      let stampImage
      const imgBuffer = Buffer.from(stamp.imageBase64, 'base64')
      try {
        stampImage = await pdfDoc.embedPng(imgBuffer)
      } catch {
        try {
          stampImage = await pdfDoc.embedJpg(imgBuffer)
        } catch {
          continue
        }
      }

      // 缩放
      const stampWidth = stamp.width
      const stampHeight = stamp.height

      // 计算位置 (canvas坐标转PDF坐标: Y轴翻转)
      const pdfX = stamp.x
      const pdfY = pageHeight - stamp.y - stampHeight

      // 绘制印章（印章图片已在渲染端预旋转，此处 rotation 始终为 0）
      page.drawImage(stampImage, {
        x: pdfX,
        y: pdfY,
        width: stampWidth,
        height: stampHeight,
        opacity: stamp.opacity
      })
    }

    const pdfBytes = await pdfDoc.save()
    return { data: Buffer.from(pdfBytes).toString('base64') }
  } catch (err: any) {
    return { error: err.message || 'PDF 合成失败' }
  }
})

// 保存导出文件
ipcMain.handle('dialog:saveFile', async (_event, base64Data: string, defaultName: string, filters: Array<{ name: string; extensions: string[] }>) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '保存盖章文件',
    defaultPath: defaultName,
    filters
  })
  if (result.canceled || !result.filePath) return { success: false }
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    writeFileSync(result.filePath, buffer)
    return { success: true, path: result.filePath }
  } catch (err: any) {
    return { success: false, error: err.message || '文件保存失败' }
  }
})

// 按路径读取文件（用于拖拽导入）
ipcMain.handle('file:readByPath', async (_event, filePath: string) => {
  try {
    const buffer = readFileSync(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const name = filePath.split(/[/\\]/).pop() || 'file'
    return {
      path: filePath,
      name,
      ext,
      size: buffer.length,
      data: buffer.toString('base64')
    }
  } catch (err: any) {
    return { error: err.message || '文件读取失败' }
  }
})
