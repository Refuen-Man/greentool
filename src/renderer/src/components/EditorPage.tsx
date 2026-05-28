import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Space, Tooltip, Slider } from 'antd'
import {
  ArrowLeftOutlined, UndoOutlined, RedoOutlined,
  ZoomInOutlined, ZoomOutOutlined, ExportOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  LeftOutlined, RightOutlined, SwapOutlined
} from '@ant-design/icons'
import { useAppStore } from '../store'
import DocumentPreview from './DocumentPreview'
import StampCanvas from './StampCanvas'
import StampManager from './StampManager'
import PropertyPanel from './PropertyPanel'
import ExportDialog from './ExportDialog'

export default function EditorPage() {
  const navigate = useNavigate()
  const {
    document: docInfo, setView, setDocument,
    sidebarCollapsed, toggleSidebar,
    zoom, setZoom,
    undo, redo, historyIndex, history,
    currentPage, setCurrentPage,
    setExportDialogVisible,
    documentDisplayWidth, documentDisplayHeight,
    a4Landscape, setA4Landscape
  } = useAppStore()

  // 键盘快捷键
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
    }
  }, [undo, redo])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleBack = () => {
    setDocument(null)
    setView('welcome')
    navigate('/')
  }

  if (!docInfo) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#94a3b8', flexDirection: 'column', gap: 12
      }}>
        <span style={{ fontSize: 48 }}>📄</span>
        <span>未加载文档</span>
        <Button type="primary" onClick={handleBack}>返回首页</Button>
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* 顶部栏 */}
      <header className="app-header">
        <div className="header-left">
          <Tooltip title="返回">
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack} />
          </Tooltip>
          <span className="app-logo">绿鹦鹉工具箱</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>
            {docInfo.name}
          </span>
        </div>
        <div className="header-right">
          <Space size={4}>
            <Tooltip title="撤销 (Ctrl+Z)">
              <Button type="text" icon={<UndoOutlined />}
                disabled={historyIndex <= 0} onClick={undo} />
            </Tooltip>
            <Tooltip title="重做 (Ctrl+Y)">
              <Button type="text" icon={<RedoOutlined />}
                disabled={historyIndex >= history.length - 1} onClick={redo} />
            </Tooltip>
            <div style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
            <Tooltip title="缩小">
              <Button type="text" icon={<ZoomOutOutlined />}
                onClick={() => setZoom(zoom - 0.1)} disabled={zoom <= 0.25} />
            </Tooltip>
            <Slider
              min={25} max={300} value={Math.round(zoom * 100)}
              onChange={(v) => setZoom(v / 100)}
              style={{ width: 120 }}
              tooltip={{ formatter: (v) => `${v}%` }}
            />
            <Tooltip title="放大">
              <Button type="text" icon={<ZoomInOutlined />}
                onClick={() => setZoom(zoom + 0.1)} disabled={zoom >= 3} />
            </Tooltip>
            <div style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
            <Tooltip title={a4Landscape ? '切换为纵向A4' : '切换为横向A4'}>
              <Button
                type={a4Landscape ? 'primary' : 'text'}
                icon={<SwapOutlined rotate={90} />}
                onClick={() => setA4Landscape(!a4Landscape)}
                style={{ fontSize: 14 }}
              >
                {a4Landscape ? '横向' : '纵向'}A4
              </Button>
            </Tooltip>
            <div style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
            <Tooltip title={sidebarCollapsed ? '展开面板' : '收起面板'}>
              <Button type="text"
                icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleSidebar} />
            </Tooltip>
          </Space>
        </div>
      </header>

      {/* 主体区域 */}
      <div className="app-body">
        {!sidebarCollapsed && (
          <aside className="app-sidebar">
            <div className="sidebar-section">
              <div className="sidebar-title">印章库</div>
              <StampManager />
            </div>
            <div className="sidebar-section">
              <div className="sidebar-title">属性</div>
              <PropertyPanel />
            </div>
            <div style={{ padding: '12px 16px', marginTop: 'auto', borderTop: '1px solid #f1f5f9' }}>
              <Button
                type="primary"
                block
                icon={<ExportOutlined />}
                style={{ borderRadius: 8 }}
                onClick={() => setExportDialogVisible(true)}
              >
                导出盖章文档
              </Button>
            </div>
          </aside>
        )}

        <main className="app-main">
          <div className="main-canvas-area">
            <div
              className="canvas-wrapper"
              style={{
                width: documentDisplayWidth,
                height: documentDisplayHeight,
                transform: `scale(${zoom})`,
                transformOrigin: 'center center'
              }}
            >
              <StampCanvas>
                <DocumentPreview />
              </StampCanvas>
            </div>
          </div>
        </main>
      </div>

      {/* 底部状态栏 */}
      <footer className="app-footer">
        <span>缩放: {Math.round(zoom * 100)}%</span>
        <div className="page-controls">
          {docInfo.pageCount > 1 && (
            <>
              <Button
                type="text"
                size="small"
                icon={<LeftOutlined />}
                disabled={currentPage <= 0}
                onClick={() => setCurrentPage(currentPage - 1)}
              />
              <span className="page-info">
                {currentPage + 1} / {docInfo.pageCount}
              </span>
              <Button
                type="text"
                size="small"
                icon={<RightOutlined />}
                disabled={currentPage >= docInfo.pageCount - 1}
                onClick={() => setCurrentPage(currentPage + 1)}
              />
            </>
          )}
        </div>
        <span>绿鹦鹉工具箱 v1.0.0</span>
      </footer>

      {/* 导出对话框 */}
      <ExportDialog />
    </div>
  )
}
