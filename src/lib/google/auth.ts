/**
 * Google 로그인 (Google Identity Services, OAuth 2.0 토큰 방식).
 * - 액세스 토큰은 메모리에만 보관한다. 클라이언트 시크릿은 쓰지 않는다.
 * - 실제 접근 제한은 Google Cloud의 OAuth "테스트 사용자" 등록과 appDataFolder 격리가 담당하고,
 *   여기의 허용 이메일 확인은 2차 화면 차단이다(REQUIREMENTS.md 3.2).
 */

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'email'].join(' ')
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

export interface AccessToken {
  value: string
  /** 만료 시각 (ms) */
  expiresAt: number
}

export interface GoogleAuth {
  /** 로그인 창을 띄워 토큰을 받는다. 반드시 사용자 클릭에서 호출해야 팝업이 차단되지 않는다. */
  requestToken(hintEmail?: string): Promise<AccessToken>
  revoke(token: string): Promise<void>
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 허용 이메일(해시)과 같은지. 해시가 비어 있으면 아무도 허용하지 않는다(설정 누락 시 차단). */
export async function isAllowedEmail(email: string, allowedSha256: string): Promise<boolean> {
  const expected = allowedSha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(expected)) return false
  return (await sha256Hex(normalizeEmail(email))) === expected
}

/** 토큰으로 로그인한 계정의 이메일을 확인한다. */
export async function fetchUserEmail(token: string, fetchFn: FetchFn = fetch): Promise<{ email: string; verified: boolean }> {
  const response = await fetchFn(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`계정 정보를 확인하지 못했습니다. (${response.status})`)
  const body = (await response.json()) as { email?: unknown; email_verified?: unknown }
  if (typeof body.email !== 'string') throw new Error('계정 이메일을 확인하지 못했습니다.')
  return { email: body.email, verified: body.email_verified === true }
}

// ---------- Google Identity Services ----------

interface GisTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void
}

interface GisGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string
        scope: string
        callback: (response: GisTokenResponse) => void
        error_callback?: (error: { type: string; message?: string }) => void
      }): GisTokenClient
      revoke(token: string, done?: () => void): void
    }
  }
}

declare global {
  interface Window {
    google?: GisGlobal
  }
}

let scriptPromise: Promise<GisGlobal> | null = null

function loadGis(): Promise<GisGlobal> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google)
  scriptPromise ??= new Promise<GisGlobal>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다.')))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다. 네트워크를 확인하세요.'))
    }
    document.head.append(script)
  })
  return scriptPromise
}

export function createGisAuth(clientId: string): GoogleAuth {
  return {
    async requestToken(hintEmail) {
      const google = await loadGis()
      return new Promise<AccessToken>((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: GOOGLE_SCOPES,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error_description ?? response.error ?? '로그인하지 못했습니다.'))
              return
            }
            resolve({ value: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 })
          },
          error_callback: (error) =>
            reject(new Error(error.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : (error.message ?? '로그인하지 못했습니다.'))),
        })
        client.requestAccessToken(hintEmail ? { prompt: '', login_hint: hintEmail } : { prompt: 'select_account' })
      })
    },
    async revoke(token) {
      const google = await loadGis()
      await new Promise<void>((resolve) => google.accounts.oauth2.revoke(token, resolve))
    },
  }
}
