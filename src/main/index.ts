import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { PDFDocument } from 'pdf-lib'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'

let mainWindow: BrowserWindow | null = null

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

/** CSS 颜色值 */
const xlColorToCss = (color: any): string => {
  if (!color) return ''
  if (color.rgb) {
    const r = color.rgb
    if (r.length === 8) return '#' + r.slice(2)        // ARGB → RGB
    return '#' + r
  }
  if (color.theme !== undefined) {
    const t = [
      '#FFFFFF','#000000','#EEECE1','#1F497D','#4F81BD',
      '#C0504D','#9BBB59','#8064A2','#4BACC6','#F79646',
      '#0000FF','#800080'
    ]
    if (color.theme >= 0 && color.theme < t.length) return t[color.theme]
  }
  if (color.indexed !== undefined) {
    const idx: Record<number,string> = {
      0:'#000000',1:'#FFFFFF',2:'#FF0000',3:'#00FF00',4:'#0000FF',
      5:'#FFFF00',6:'#FF00FF',7:'#00FFFF',8:'#000000',9:'#FFFFFF',
      10:'#FF0000',11:'#00FF00',12:'#0000FF',13:'#FFFF00',14:'#FF00FF',
      15:'#00FFFF',16:'#800000',17:'#008000',18:'#000080',19:'#808000',
      20:'#800080',21:'#008080',22:'#C0C0C0',23:'#808080',
    }
    return idx[color.indexed] || ''
  }
  return ''
}

/** 边框样式 → CSS */
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

/** 对齐值映射 */
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

  // 合并单元格映射：标记被覆盖的格子
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

  // ---------- 构建 <colgroup> ----------
  let colsHtml = ''
  if (colsInfo.length > 0) {
    colsHtml = '<colgroup>'
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ci = colsInfo[c]
      if (ci?.wpx) {
        colsHtml += `<col style="width:${ci.wpx}px">`
      } else if (ci?.wch) {
        colsHtml += `<col style="width:${Math.round(ci.wch * 7.5)}px">`
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
    const rhAttr = ri?.hpx ? ` style="height:${ri.hpx}px"` : ''
    rowsHtml += `<tr${rhAttr}>`

    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = r + ',' + c
      if (mergeSkip.has(key)) continue

      const cellRef = XLSX.utils.encode_cell({ r, c })
      const raw = (sheet as any)[cellRef]
      // 统一转为 cell 对象
      const cell: any = raw && typeof raw === 'object' ? raw : (raw != null ? { v: raw, t: 'n' } : null)

      // 合并行列
      const span = mergeSpan[key]
      const csAttr = span?.cs && span.cs > 1 ? ` colspan="${span.cs}"` : ''
      const rsAttr = span?.rs && span.rs > 1 ? ` rowspan="${span.rs}"` : ''

      // ---------- 提取单元格样式 ----------
      const css: string[] = []
      if (cell?.s != null && cellXfs[cell.s]) {
        const xf = cellXfs[cell.s]

        // 填充色
        if (xf.fillId != null && fills[xf.fillId]) {
          const fill = fills[xf.fillId]
          if (fill.fgColor) {
            const bg = xlColorToCss(fill.fgColor)
            if (bg) css.push('background-color:' + bg)
          }
          if (fill.bgColor && !fill.fgColor) {
            const bg = xlColorToCss(fill.bgColor)
            if (bg) css.push('background-color:' + bg)
          }
        }

        // 字体
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
          if (a.wrapText) {
            css.push('white-space:pre-wrap')
            css.push('word-break:break-word')
          } else {
            css.push('white-space:nowrap')
          }
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

      // 内边距
      css.push('padding:2px 6px')

      const styleAttr = css.length > 0 ? ' style="' + css.join(';') + '"' : ''

      // 单元格文字
      const text = cell ? (cell.w || cell.v || '') : ''
      const disp = text != null ? String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''

      const tag = r === 0 ? 'th' : 'td'
      rowsHtml += `<${tag}${styleAttr}${csAttr}${rsAttr}>${disp}</${tag}>`
    }
    rowsHtml += '</tr>'
  }

  return `<table>${colsHtml}${rowsHtml}</table>`
}

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
