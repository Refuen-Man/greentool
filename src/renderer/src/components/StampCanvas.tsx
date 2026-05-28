import { useEffect, useRef, useCallback } from 'react'
import { Canvas, FabricImage, type FabricObject } from 'fabric'
import { message } from 'antd'
import { useAppStore } from '../store'
import type { StampOnCanvas } from '../types'

interface Props {
  children: React.ReactNode
}

export default function StampCanvas({ children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    stamps, activeStampId, setActiveStampId,
    stampsOnCanvas, addStampToCanvas, updateStampOnCanvas,
    removeStampFromCanvas, currentPage, pushHistory,
    documentDisplayWidth, documentDisplayHeight,
    crossPageMode
  } = useAppStore()

  // 获取 fabric canvas 实际可用尺寸
  const canvasW = documentDisplayWidth || 800
  const canvasH = documentDisplayHeight || 600

  // 初始化 fabric canvas
  useEffect(() => {
    if (!canvasRef.current || fabricRef.current) return

    const canvas = new Canvas(canvasRef.current, {
      selection: true,
      preserveObjectStacking: true,
      backgroundColor: 'transparent',
      width: canvasW,
      height: canvasH
    })

    fabricRef.current = canvas

    // 选中对象时更新 activeStampId
    canvas.on('selection:created', (e: { selected?: FabricObject[] }) => {
      const obj = e.selected?.[0]
      const stampId = obj && (obj as any)._stampCanvasId
      if (stampId) {
        setActiveStampId(stampId)
      }
    })

    canvas.on('selection:updated', (e: { selected?: FabricObject[] }) => {
      const obj = e.selected?.[0]
      const stampId = obj && (obj as any)._stampCanvasId
      if (stampId) {
        setActiveStampId(stampId)
      }
    })

    canvas.on('selection:cleared', () => {
      setActiveStampId(null)
    })

    // 对象修改完成后同步状态
    canvas.on('object:modified', (e: { target?: FabricObject }) => {
      const obj = e.target as FabricObject | undefined
      if (!obj || !(obj as any)._stampCanvasId) return

      const stampCanvasId = (obj as any)._stampCanvasId
      updateStampOnCanvas(stampCanvasId, {
        x: obj.left!,
        y: obj.top!,
        scaleX: obj.scaleX!,
        scaleY: obj.scaleY!,
        width: obj.getScaledWidth(),
        height: obj.getScaledHeight(),
        angle: obj.angle!,
        opacity: obj.opacity!
      })
      pushHistory(useAppStore.getState().stampsOnCanvas)
    })

    return () => {
      canvas.dispose()
      fabricRef.current = null
    }
  }, [])

  // 键盘删除 - 使用 ref 避免闭包过期
  const activeStampIdRef = useRef(activeStampId)
  activeStampIdRef.current = activeStampId

  useEffect(() => {
    if (!fabricRef.current) return
    const canvas = fabricRef.current

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        // 避免在输入框中误触发
        const activeEl = window.document.activeElement
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return
        
        const currentActiveId = activeStampIdRef.current
        if (currentActiveId) {
          const activeObj = canvas.getActiveObject()
          if (activeObj && (activeObj as any)._stampCanvasId === currentActiveId) {
            canvas.remove(activeObj)
            canvas.discardActiveObject()
            canvas.renderAll()
            removeStampFromCanvas(currentActiveId)
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [removeStampFromCanvas])

  // 当文档显示尺寸变化时，调整 fabric canvas 大小
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    if (canvasW > 0 && canvasH > 0) {
      canvas.setWidth(canvasW)
      canvas.setHeight(canvasH)
      canvas.renderAll()
    }
  }, [canvasW, canvasH])

  // 当 stampsOnCanvas 状态变化时同步到 fabric 对象
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    stampsOnCanvas.forEach((sc) => {
      const obj = canvas.getObjects().find(
        (o: FabricObject) => (o as any)._stampCanvasId === sc.id
      ) as any
      if (obj) {
        // 检查是否需要更新
        let needsUpdate = false
        if (Math.abs(obj.left - sc.x) > 0.1) { obj.left = sc.x; needsUpdate = true }
        if (Math.abs(obj.top - sc.y) > 0.1) { obj.top = sc.y; needsUpdate = true }
        if (Math.abs(obj.scaleX - sc.scaleX) > 0.001) { obj.scaleX = sc.scaleX; needsUpdate = true }
        if (Math.abs(obj.scaleY - sc.scaleY) > 0.001) { obj.scaleY = sc.scaleY; needsUpdate = true }
        if (Math.abs(obj.opacity - sc.opacity) > 0.001) { obj.opacity = sc.opacity; needsUpdate = true }
        if (Math.abs(obj.angle - sc.angle) > 0.01) { obj.angle = sc.angle; needsUpdate = true }
        if (needsUpdate) {
          obj.setCoords()
        }
      }
    })

    // 移除已在 store 中不存在的孤儿 fabric 对象
    const currentIds = new Set(stampsOnCanvas.map((sc) => sc.id))
    const orphans = canvas.getObjects().filter(
      (o: FabricObject) => {
        const id = (o as any)._stampCanvasId
        return id && !currentIds.has(id)
      }
    )
    orphans.forEach((o: FabricObject) => canvas.remove(o))

    if (stampsOnCanvas.length > 0 || canvas.getObjects().length > 0) {
      canvas.renderAll()
    }
  }, [stampsOnCanvas])

  // 当 activeStampId 变化时，高亮对应对象
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    if (activeStampId) {
      const obj = canvas.getObjects().find(
        (o: FabricObject) => (o as any)._stampCanvasId === activeStampId
      )
      if (obj) {
        canvas.setActiveObject(obj)
        canvas.renderAll()
      }
    } else {
      canvas.discardActiveObject()
      canvas.renderAll()
    }
  }, [activeStampId])

  // 放置印章到画布
  const placeStamp = useCallback((stampId: string, e?: React.MouseEvent) => {
    const canvas = fabricRef.current
    if (!canvas) return

    const stamp = stamps.find((s) => s.id === stampId)
    if (!stamp) return

    // 加载图片
    FabricImage.fromURL(stamp.dataUrl, { crossOrigin: 'anonymous' }).then((img) => {
      // 限制印章初始大小
      const maxSize = 200
      let w = stamp.originalWidth
      let h = stamp.originalHeight
      if (w > maxSize || h > maxSize) {
        const ratio = maxSize / Math.max(w, h)
        w *= ratio
        h *= ratio
      }

      const canvasStampId = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const storeState = useAppStore.getState()
      const isCrossPage = storeState.crossPageMode

      let posX: number, posY: number

      if (isCrossPage) {
        // 骑缝章模式：印章放在页面右侧边缘，跨两页
        posX = canvas.getWidth() - w * 0.6
        posY = canvas.getHeight() / 2 - h / 2
      } else {
        // 普通模式：居中放置
        posX = canvas.getWidth() / 2 - w / 2
        posY = canvas.getHeight() / 2 - h / 2
      }

      img.set({
        left: posX,
        top: posY,
        scaleX: w / (img as any).width,
        scaleY: h / (img as any).height,
        opacity: 0.85,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        cornerColor: '#16a34a',
        cornerSize: 10,
        transparentCorners: false,
        borderColor: isCrossPage ? '#f59e0b' : '#16a34a'
      })
      ;(img as any)._stampCanvasId = canvasStampId
      ;(img as any)._stampId = stampId
      ;(img as any)._isCrossPage = isCrossPage

      canvas.add(img)
      canvas.setActiveObject(img)
      canvas.renderAll()

      const stampData: StampOnCanvas = {
        id: canvasStampId,
        stampId,
        x: posX,
        y: posY,
        scaleX: w / (img as any).width,
        scaleY: h / (img as any).height,
        width: w,
        height: h,
        opacity: 0.85,
        angle: 0,
        pageIndex: currentPage,
        isCrossPage
      }

      addStampToCanvas(stampData)
      setActiveStampId(canvasStampId)

      // 骑缝章：在下一页创建右半部分的伴生印章（含 fabric 对象）
      if (isCrossPage && currentPage + 1 < (storeState.document?.pageCount || 1)) {
        // 为伴生印章创建独立的 fabric 图像对象
        FabricImage.fromURL(stamp.dataUrl, { crossOrigin: 'anonymous' }).then((companionImg) => {
          const companionId = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const companionW = w
          const companionH = h
          // 伴生印章位于下一页右侧（左半部分可见）
          const companionX = canvas.getWidth() - companionW * 0.4
          const companionY = posY

          companionImg.set({
            left: companionX,
            top: companionY,
            scaleX: companionW / (companionImg as any).width,
            scaleY: companionH / (companionImg as any).height,
            opacity: 0.85,
            selectable: true,
            hasControls: true,
            hasBorders: true,
            cornerColor: '#f59e0b',
            cornerSize: 10,
            transparentCorners: false,
            borderColor: '#f59e0b'
          })
          ;(companionImg as any)._stampCanvasId = companionId
          ;(companionImg as any)._stampId = stampId
          ;(companionImg as any)._isCrossPage = true

          const canvas = fabricRef.current
          if (canvas) {
            canvas.add(companionImg)
            canvas.renderAll()
          }

          const companionData: StampOnCanvas = {
            id: companionId,
            stampId,
            x: companionX,
            y: companionY,
            scaleX: companionW / (companionImg as any).width,
            scaleY: companionH / (companionImg as any).height,
            width: companionW,
            height: companionH,
            opacity: 0.85,
            angle: 0,
            pageIndex: currentPage + 1,
            isCrossPage: true
          }
          addStampToCanvas(companionData)
        }).catch((err: Error) => {
          console.error('骑缝章伴生印章加载失败:', err)
        })
      }
    }).catch((err: Error) => {
      console.error('印章加载失败:', err)
      message.error('印章图片加载失败')
    })
  }, [stamps, currentPage, addStampToCanvas, setActiveStampId])

  // 删除印章
  const deleteStamp = useCallback((stampCanvasId: string) => {
    const canvas = fabricRef.current
    if (!canvas) return
    const obj = canvas.getObjects().find((o: FabricObject) => (o as any)._stampCanvasId === stampCanvasId)
    if (obj) {
      canvas.remove(obj)
      canvas.renderAll()
    }
    removeStampFromCanvas(stampCanvasId)
  }, [removeStampFromCanvas])

  // 暴露方法给父组件
  useEffect(() => {
    (window as any).__stampCanvas = {
      placeStamp,
      deleteStamp,
      canvas: fabricRef.current
    }
    return () => {
      delete (window as any).__stampCanvas
    }
  }, [placeStamp, deleteStamp])

  // 页码切换时过滤印章（骑缝章在相邻页也可见）
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    canvas.getObjects().forEach((obj: FabricObject) => {
      const stampCanvasId = (obj as any)._stampCanvasId
      if (!stampCanvasId) return
      const stampState = stampsOnCanvas.find((s) => s.id === stampCanvasId)
      if (!stampState) {
        obj.visible = false
        return
      }
      // 骑缝章：主章仅在自己的页面可见，伴生章在自己的页面可见
      // （伴生章位置为负x，使其右半部分在页面上显示）
      if (stampState.isCrossPage) {
        obj.visible = stampState.pageIndex === currentPage
      } else {
        obj.visible = stampState.pageIndex === currentPage
      }
    })
    canvas.renderAll()
  }, [currentPage, stampsOnCanvas])

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {/* 文档预览层 */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 0,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start'
      }}>
        {children}
      </div>

      {/* 印章 Canvas 层 */}
      <canvas ref={canvasRef} style={{
        position: 'absolute',
        top: 0, left: 0,
        zIndex: 1
      }} />
    </div>
  )
}
