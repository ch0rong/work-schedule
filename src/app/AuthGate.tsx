import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogIn, ShieldCheck } from 'lucide-react'
import { fetchUserEmail, isAllowedEmail, normalizeEmail, type AccessToken, type GoogleAuth } from '../lib/google/auth'
import { createDriveClient } from '../lib/google/drive'
import { createDriveRepository, type DriveRepository } from '../lib/google/driveRepository'
import { createStore, type AppStore } from '../lib/store'
import App from './App'
import { SessionContext, type Session } from './sessionContext'

export interface AuthGateProps {
  auth: GoogleAuth
  /** 허용 이메일(소문자)의 SHA-256 */
  allowedEmailHash: string
  fetchEmail?: (token: string) => Promise<{ email: string; verified: boolean }>
  createRepository?: (getToken: () => string) => DriveRepository
}

type GateState =
  | { kind: 'signed-out'; message?: string; tone?: 'info' | 'error' }
  | { kind: 'busy'; label: string }
  | { kind: 'ready'; store: AppStore; repository: DriveRepository; email: string }

const IDLE_CHECK_MS = 30_000
/** 화면을 보고 있는 동안 다른 기기 변경을 확인하는 간격 */
const SYNC_POLL_MS = 5_000

/** 메모리에만 두는 액세스 토큰 (localStorage·쿠키에 저장하지 않음) */
class TokenHolder {
  private token: AccessToken | null = null
  get(): AccessToken | null {
    return this.token
  }
  set(token: AccessToken | null): void {
    this.token = token
  }
}

/**
 * 로그인 전에는 앱 화면과 데이터를 전혀 만들지 않는다.
 * 허용된 계정으로 로그인한 뒤에만 Drive에서 데이터를 불러와 앱을 보여준다.
 */
export function AuthGate({
  auth,
  allowedEmailHash,
  fetchEmail = (token) => fetchUserEmail(token),
  createRepository = (getToken) => createDriveRepository(createDriveClient(getToken)),
}: AuthGateProps) {
  const [state, setState] = useState<GateState>({ kind: 'signed-out' })
  const [expired, setExpired] = useState(false)
  /** 액세스 토큰은 화면에 쓰지 않는 메모리 값이므로 렌더링과 무관한 보관 객체에 둔다 */
  const [token] = useState(() => new TokenHolder())

  /** 토큰을 받아 계정을 확인한다. 허용되지 않으면 토큰을 즉시 폐기한다. */
  const verify = useCallback(
    async (hintEmail?: string): Promise<{ token: AccessToken; email: string } | { denied: string }> => {
      const next = await auth.requestToken(hintEmail)
      const { email, verified } = await fetchEmail(next.value)
      if (!verified || !(await isAllowedEmail(email, allowedEmailHash))) {
        await auth.revoke(next.value).catch(() => {})
        return { denied: email }
      }
      return { token: next, email }
    },
    [auth, allowedEmailHash, fetchEmail],
  )

  const signIn = useCallback(async () => {
    setState({ kind: 'busy', label: 'Google 계정 확인 중…' })
    try {
      const result = await verify()
      if ('denied' in result) {
        setState({ kind: 'signed-out', tone: 'error', message: `${result.denied} 계정은 이 서비스에 접근할 수 없습니다. 허용된 본인 계정으로 로그인하세요.` })
        return
      }
      token.set(result.token)
      setExpired(false)
      setState({ kind: 'busy', label: 'Google Drive에서 데이터를 불러오는 중…' })
      const repository = createRepository(() => token.get()?.value ?? '')
      const loaded = await repository.load()
      const store = createStore(loaded, (data) => repository.save(data), undefined, () => repository.pull())
      setState({ kind: 'ready', store, repository, email: result.email })
    } catch (error) {
      token.set(null)
      setState({ kind: 'signed-out', tone: 'error', message: error instanceof Error ? error.message : '로그인하지 못했습니다.' })
    }
  }, [verify, createRepository, token])

  const logout = useCallback(
    async (reason?: string) => {
      if (state.kind === 'ready') {
        // 진행 중인 저장을 최대 5초 기다린 뒤 로그아웃
        await Promise.race([state.store.flush(), new Promise((resolve) => setTimeout(resolve, 5000))])
      }
      const current = token.get()
      token.set(null)
      if (current) await auth.revoke(current.value).catch(() => {})
      // 메모리의 데이터는 store와 함께 버려진다
      setState({ kind: 'signed-out', tone: 'info', message: reason ?? '로그아웃했습니다.' })
    },
    [auth, state, token],
  )

  // 토큰 만료 시각에 만료 표시 (다시 로그인 버튼은 사용자 클릭으로)
  useEffect(() => {
    if (state.kind !== 'ready' || !token.get()) return
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, token.get()!.expiresAt - Date.now() - 60_000))
    return () => window.clearTimeout(timer)
  }, [state, expired, token])

  // 사용하지 않으면 자동 로그아웃
  useEffect(() => {
    if (state.kind !== 'ready') return
    let last = Date.now()
    const touch = () => (last = Date.now())
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }))
    const timer = window.setInterval(() => {
      const limit = state.store.getState().data.settings.session.idleLogoutMinutes * 60_000
      if (Date.now() - last >= limit) void logout('오랫동안 사용하지 않아 자동으로 로그아웃했습니다.')
    }, IDLE_CHECK_MS)
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch))
      window.clearInterval(timer)
    }
  }, [state, logout])

  const ready = state.kind === 'ready' ? state : null

  const reauth = useCallback(async () => {
    if (!ready) return
    const result = await verify(ready.email)
    if ('denied' in result || normalizeEmail(result.email) !== normalizeEmail(ready.email)) {
      await logout('다른 계정으로 로그인되어 로그아웃했습니다.')
      return
    }
    token.set(result.token)
    setExpired(false)
    await ready.store.retrySave()
  }, [ready, verify, logout, token])

  // 실시간 동기화: 화면을 보는 동안 주기적으로, 그리고 창으로 돌아오거나 네트워크가 다시 연결되면 바로 다른 기기 변경을 가져와 합친다
  useEffect(() => {
    if (state.kind !== 'ready' || expired) return
    const { store } = state
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.refresh()
    }
    const timer = window.setInterval(refresh, SYNC_POLL_MS)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [state, expired])

  const session = useMemo<Session | null>(
    () => (ready ? { email: ready.email, expired, logout, reauth } : null),
    [ready, expired, logout, reauth],
  )

  if (ready && session) {
    return (
      <SessionContext.Provider value={session}>
        <App store={ready.store} />
      </SessionContext.Provider>
    )
  }

  return (
    <main className="login-page">
      <div className="login-card card">
        <ShieldCheck aria-hidden="true" size={36} className="login-icon" />
        <h1 className="app-title">근무 스케줄</h1>
        <p className="muted">본인 Google 계정으로 로그인하세요. 데이터는 본인 Google Drive의 앱 전용 숨김 폴더에 저장됩니다.</p>
        {state.kind === 'signed-out' && state.message && (
          <p className={`alert ${state.tone === 'error' ? 'alert-danger' : 'alert-info'}`} role={state.tone === 'error' ? 'alert' : 'status'}>
            {state.message}
          </p>
        )}
        <button type="button" className="button button-primary login-button" onClick={signIn} disabled={state.kind === 'busy'}>
          <LogIn aria-hidden="true" size={18} />
          {state.kind === 'busy' ? state.label : 'Google 계정으로 로그인'}
        </button>
        <p className="muted small">허용된 계정 외에는 로그인되더라도 화면과 데이터에 접근할 수 없습니다.</p>
      </div>
    </main>
  )
}
