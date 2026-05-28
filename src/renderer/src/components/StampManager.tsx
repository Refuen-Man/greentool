import { Button, message, Empty, Tooltip, Switch } from 'antd'
import { PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import type { StampItem } from '../types'

export default function StampManager() {
  const { stamps, addStamp, removeStamp, activeStampId, stampsOnCanvas, crossPageMode, setCrossPageMode } = useAppStore()

  // 通过 activeStampId (canvas印章ID) 找到对应的库印章ID
  const activeCanvasStamp = stampsOnCanvas.find((s) => s.id === activeStampId)
  const activeLibraryStampId = activeCanvasStamp?.stampId || null

  const handleImportStamp = async () => {
    try {
      const result = await window.electronAPI.openStamp()
      if (!result) return

      // 创建 data URL
      const dataUrl = `data:${result.mimeType};base64,${result.data}`

      // 获取原始尺寸
      const img = new Image()
      img.onload = () => {
        const stamp: StampItem = {
          id: `stamp_${Date.now()}`,
          name: result.name,
          dataUrl,
          imageBase64: result.data,
          mimeType: result.mimeType,
          originalWidth: img.naturalWidth,
          originalHeight: img.naturalHeight
        }
        addStamp(stamp)
        message.success(`印章 "${result.name}" 已导入`)
      }
      img.onerror = () => {
        message.error('印章图片加载失败')
      }
      img.src = dataUrl
    } catch (err: any) {
      message.error(err.message || '印章导入失败')
    }
  }

  const handlePlaceStamp = (stampId: string) => {
    const stampCanvas = (window as any).__stampCanvas
    if (stampCanvas && stampCanvas.placeStamp) {
      stampCanvas.placeStamp(stampId)
    }
  }

  return (
    <div>
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={handleImportStamp}
        style={{ borderRadius: 8, marginBottom: 12 }}
      >
        导入印章图片
      </Button>

      {stamps.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无印章，请导入"
          style={{ marginTop: 20 }}
        />
      ) : (
        <div className="stamp-thumb-list">
          {stamps.map((stamp) => (
            <Tooltip key={stamp.id} title={stamp.name}>
              <div
                className={`stamp-thumb-item ${activeLibraryStampId === stamp.id ? 'active' : ''}`}
                onClick={() => handlePlaceStamp(stamp.id)}
              >
                <img src={stamp.dataUrl} alt={stamp.name} />
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeStamp(stamp.id)
                  }}
                >
                  <CloseOutlined style={{ fontSize: 8 }} />
                </button>
              </div>
            </Tooltip>
          ))}
        </div>
      )}

      {stamps.length > 0 && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 12, padding: '8px 10px',
            background: crossPageMode ? '#fef3c7' : '#f8fafc',
            borderRadius: 8, border: crossPageMode ? '1px solid #f59e0b' : '1px solid #e2e8f0'
          }}>
            <span style={{ fontSize: 12, color: crossPageMode ? '#92400e' : '#64748b' }}>
              骑缝章模式
            </span>
            <Switch
              size="small"
              checked={crossPageMode}
              onChange={setCrossPageMode}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
            点击印章可添加到文档
          </div>
        </>
      )}
    </div>
  )
}
