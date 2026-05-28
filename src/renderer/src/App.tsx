import { Routes, Route, Navigate } from 'react-router-dom'
import { Component, type ReactNode } from 'react'
import { useAppStore } from './store'
import WelcomePage from './components/WelcomePage'
import EditorPage from './components/EditorPage'

// 错误边界 - 捕获渲染错误，防止白屏
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary] 捕获到渲染错误:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#fee2e2', color: '#991b1b', gap: 16, padding: 40
        }}>
          <h2>应用发生错误</h2>
          <pre style={{
            maxWidth: 600, whiteSpace: 'pre-wrap', fontSize: 13,
            background: '#fff', padding: 16, borderRadius: 8
          }}>
            {this.state.error}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: '' })
              window.location.hash = '#/'
            }}
            style={{
              padding: '8px 24px', borderRadius: 8, border: 'none',
              background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 14
            }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const view = useAppStore((s) => s.view)

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={view === 'welcome' ? <WelcomePage /> : <Navigate to="/editor" replace />} />
        <Route path="/editor" element={<EditorPage />} />
      </Routes>
    </ErrorBoundary>
  )
}
