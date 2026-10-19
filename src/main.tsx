import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { AuthGate } from './app/AuthGate'
import { ConfigError } from './app/ConfigError'
import { createGisAuth } from './lib/google/auth'
import { createAppStore } from './lib/store'
import { getBrowserStorage } from './lib/storage'
import './styles/global.css'
import './styles/components.css'
import './styles/v2.css'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
const allowedEmailHash = import.meta.env.VITE_ALLOWED_EMAIL_SHA256?.trim() ?? ''
/** 로컬 모드(로그인 없음, localStorage)는 개발 서버 또는 명시적으로 허용한 빌드에서만 */
const localModeAllowed = import.meta.env.DEV || import.meta.env.VITE_ALLOW_LOCAL_MODE === 'true'


let root: ReactNode
if (clientId) {
  root = allowedEmailHash ? (
    <AuthGate auth={createGisAuth(clientId)} allowedEmailHash={allowedEmailHash} />
  ) : (
    // 허용 이메일이 설정되지 않으면 아무도 들어올 수 없게 막는다
    <ConfigError message="접근 허용 계정(VITE_ALLOWED_EMAIL_SHA256)이 설정되지 않아 서비스를 사용할 수 없습니다." />
  )
} else if (localModeAllowed) {
  root = <App store={createAppStore(getBrowserStorage())} />
} else {
  root = <ConfigError message="로그인 설정(VITE_GOOGLE_CLIENT_ID)이 없어 서비스를 사용할 수 없습니다." />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
