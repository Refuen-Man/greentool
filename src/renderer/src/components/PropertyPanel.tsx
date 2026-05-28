import { Slider, Empty, Tag } from 'antd'
import { useAppStore } from '../store'

export default function PropertyPanel() {
  const {
    activeStampId, stampsOnCanvas,
    updateStampOnCanvas, pushHistory,
    stamps
  } = useAppStore()

  const activeStamp = stampsOnCanvas.find((s) => s.id === activeStampId)
  const stampInfo = activeStamp ? stamps.find((s) => s.id === activeStamp.stampId) : null

  if (!activeStamp || !activeStampId) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="选择印章以编辑属性"
        style={{ marginTop: 10 }}
      />
    )
  }

  return (
    <div className="prop-panel">
      {/* 印章名称 */}
      <div className="prop-row">
        <span className="prop-label">印章</span>
        <span className="prop-value" style={{ fontSize: 12 }}>
          {stampInfo?.name || '未知'}
        </span>
      </div>

      {/* 骑缝章标签 */}
      {activeStamp.isCrossPage && (
        <div style={{ marginBottom: 12 }}>
          <Tag color="orange" style={{ borderRadius: 4 }}>🏷️ 骑缝章</Tag>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>
            第{activeStamp.pageIndex + 1}页 → 第{activeStamp.pageIndex + 2}页
          </span>
        </div>
      )}

      {/* 透明度 */}
      <div>
        <div className="prop-row" style={{ marginBottom: 4 }}>
          <span className="prop-label">透明度</span>
          <span className="prop-value">{Math.round(activeStamp.opacity * 100)}%</span>
        </div>
        <Slider
          min={10}
          max={100}
          value={Math.round(activeStamp.opacity * 100)}
          onChange={(v) => {
            updateStampOnCanvas(activeStampId, { opacity: v / 100 })
            pushHistory(useAppStore.getState().stampsOnCanvas)
          }}
        />
      </div>

      {/* 缩放 */}
      <div>
        <div className="prop-row" style={{ marginBottom: 4 }}>
          <span className="prop-label">缩放</span>
          <span className="prop-value">{Math.round(activeStamp.scaleX * 100)}%</span>
        </div>
        <Slider
          min={10}
          max={300}
          value={Math.round(activeStamp.scaleX * 100)}
          onChange={(v) => {
            const scale = v / 100
            updateStampOnCanvas(activeStampId, {
              scaleX: scale,
              scaleY: scale,
              width: activeStamp.width / activeStamp.scaleX * scale,
              height: activeStamp.height / activeStamp.scaleY * scale
            })
            pushHistory(useAppStore.getState().stampsOnCanvas)
          }}
        />
      </div>

      {/* 旋转 */}
      <div>
        <div className="prop-row" style={{ marginBottom: 4 }}>
          <span className="prop-label">旋转</span>
          <span className="prop-value">{Math.round(activeStamp.angle)}°</span>
        </div>
        <Slider
          min={-180}
          max={180}
          value={Math.round(activeStamp.angle)}
          onChange={(v) => {
            updateStampOnCanvas(activeStampId, { angle: v })
            pushHistory(useAppStore.getState().stampsOnCanvas)
          }}
        />
      </div>
    </div>
  )
}
