import { Button, message } from 'antd'
import { FileImageOutlined, FilePdfOutlined, FileTextOutlined, PictureOutlined, FileExcelOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import type { DocumentInfo } from '../types'

export default function WelcomePage() {
  const { setDocument, setView } = useAppStore()

  const handleOpenDocument = async () => {
    try {
      const result = await window.electronAPI.openDocument()
      if (!result || !result.data) return

      const ext = (result.ext || '').toLowerCase()
      let docType: DocumentInfo['type']
      let pageCount = 1

      if (ext === 'pdf') {
        docType = 'pdf'
        const pageResult = await window.electronAPI.getPdfPageCount(result.data)
        pageCount = pageResult.pageCount || 1
      } else if (ext === 'docx' || ext === 'doc') {
        docType = 'word'
        // 旧版 .doc 直接在这里不阻止导入，但类型设为 word，由 DocumentPreview 精确提示
      } else if (ext === 'xlsx' || ext === 'xls') {
        docType = 'excel'
      } else {
        docType = 'image'
      }

      const doc: DocumentInfo = {
        path: result.path,
        name: result.name,
        ext: result.ext,
        size: result.size,
        data: result.data,
        type: docType,
        pageCount
      }

      setDocument(doc)
      setView('editor')
    } catch (err: any) {
      message.error(err.message || '文件打开失败')
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const file = e.dataTransfer.files?.[0]
    if (!file) return

    // 尝试通过文件路径读取（Electron 环境）
    const filePath = (file as any).path
    if (filePath) {
      try {
        const result = await window.electronAPI.readFileByPath(filePath)
        if (result.error) {
          message.error(result.error)
          return
        }
        if (!result.data) return

        const ext = (result.ext || '').toLowerCase()
        let docType: DocumentInfo['type']
        let pageCount = 1

        if (ext === 'pdf') {
          docType = 'pdf'
          const pageResult = await window.electronAPI.getPdfPageCount(result.data)
          pageCount = pageResult.pageCount || 1
        } else if (ext === 'docx' || ext === 'doc') {
          docType = 'word'
        } else if (ext === 'xlsx' || ext === 'xls') {
          docType = 'excel'
        } else {
          docType = 'image'
        }

        const doc: DocumentInfo = {
          path: result.path || filePath,
          name: result.name || file.name,
          ext: result.ext || ext || '',
          size: result.size || file.size,
          data: result.data,
          type: docType,
          pageCount
        }

        setDocument(doc)
        setView('editor')
        return
      } catch (err: any) {
        message.error(err.message || '文件导入失败')
        return
      }
    }

    // Fallback: 无法获取路径时打开文件对话框
    await handleOpenDocument()
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0fdf4 0%, #f8fafc 50%, #f0f9ff 100%)',
        gap: 40
      }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDrop={handleDrop}
    >
      {/* Logo */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 80, height: 80, borderRadius: 20,
          background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 8px 32px rgba(22, 163, 74, 0.25)'
        }}>
          <span style={{ fontSize: 36, color: '#fff', fontWeight: 700 }}>绿</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          绿鹦鹉工具箱
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>
          快速盖章 · 文档处理 · 轻松导出
        </p>
      </div>

      {/* 操作区 */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        width: 360
      }}>
        <Button
          type="primary"
          size="large"
          block
          onClick={handleOpenDocument}
          style={{ height: 52, fontSize: 15, borderRadius: 12 }}
        >
          <FilePdfOutlined /> 导入待盖章文档
        </Button>

        <div style={{
          padding: 20,
          background: '#ffffff',
          borderRadius: 12,
          border: '2px dashed #e2e8f0',
          textAlign: 'center',
          cursor: 'pointer'
        }}
          onClick={handleOpenDocument}
        >
          <PictureOutlined style={{ fontSize: 32, color: '#94a3b8', marginBottom: 8 }} />
          <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
            拖拽文件到此处，或点击上方按钮导入
          </p>
        </div>
      </div>

      {/* 支持格式 */}
      <div style={{ display: 'flex', gap: 24, color: '#94a3b8', fontSize: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FilePdfOutlined /> PDF
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FileTextOutlined /> Word
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FileExcelOutlined /> Excel
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FileImageOutlined /> 图片
        </span>
      </div>

      <div style={{ position: 'absolute', bottom: 20, color: '#cbd5e1', fontSize: 12 }}>
        v1.0.0
      </div>
    </div>
  )
}
