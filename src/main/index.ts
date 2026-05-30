import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { PDFDocument } from 'pdf-lib'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'

let mainWindow: BrowserWindow | null = null

// ============ LibreOffice 路径检测 ============

function getLibreOfficePath(): string | null {
  // Production: 打包在 app resources/libreoffice/
  if (app.isPackaged) {
    const prodPath = join(process.resourcesPath, 'libreoffice', 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe')
    if (existsSync(prodPath)) return prodPath
  }
  // Development: 项目 resources/libreoffice/
  const devPath = join(__dirname, '..', '..', 'resources', 'libreoffice', 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe')
  if (existsSync(devPath)) return devPath

  // 系统安装的 LibreOffice
  try {
    const result = execFileSync('where', ['soffice.exe'], { encoding: 'utf8', timeout: 5000 })
    const paths = result.trim().split('\r\n')
    if (paths[0] && existsSync(paths[0].trim())) return paths[0].trim()
  } catch {}

  return null
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

// 解析 Excel 文档为 HTML（降级方案，使用 sheet_to_html 基础渲染）
ipcMain.handle('document:parseExcel', async (_event, base64Data: string) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return { error: 'Excel 文件中没有工作表' }
    const sheet = workbook.Sheets[sheetName]
    const html = XLSX.utils.sheet_to_html(sheet, { id: '', editable: false })
    return { html, sheetCount: 1 }
  } catch (err: any) {
    return { error: err.message || 'Excel 文档解析失败' }
  }
})

// Excel → PDF 转换（通过 LibreOffice headless，页面方向由 Excel 自身打印设置决定）
ipcMain.handle('document:excelToPdf', async (_event, base64Data: string) => {
  try {
    const libreOfficePath = getLibreOfficePath()
    if (!libreOfficePath) {
      return { error: '未找到 LibreOffice。请运行 scripts/download-libreoffice.js 下载' }
    }

    // 写入临时 Excel 文件
    const buffer = Buffer.from(base64Data, 'base64')
    const tmpDir = join(tmpdir(), `green-parrot-xls-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const excelPath = join(tmpDir, 'input.xlsx')
    writeFileSync(excelPath, buffer)

    // 调用 LibreOffice 转换
    try {
      execFileSync(libreOfficePath, [
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', tmpDir,
        excelPath
      ], { timeout: 120000 })
    } catch (e: any) {
      // 清理
      try { unlinkSync(excelPath); rmdirSync(tmpDir) } catch {}
      return { error: 'LibreOffice 转换失败: ' + (e.stderr || e.message || '') }
    }

    // 读取输出 PDF
    const pdfPath = join(tmpDir, 'input.pdf')
    if (!existsSync(pdfPath)) {
      try { unlinkSync(excelPath); rmdirSync(tmpDir) } catch {}
      return { error: 'LibreOffice 未生成 PDF 文件' }
    }

    const pdfBuffer = readFileSync(pdfPath)

    // 获取页数
    let pageCount = 1
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer)
      pageCount = pdfDoc.getPageCount()
    } catch {}

    // 清理临时文件
    try { unlinkSync(excelPath); unlinkSync(pdfPath); rmdirSync(tmpDir) } catch {}

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

      const stampWidth = stamp.width
      const stampHeight = stamp.height

      const pdfX = stamp.x
      const pdfY = pageHeight - stamp.y - stampHeight

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
