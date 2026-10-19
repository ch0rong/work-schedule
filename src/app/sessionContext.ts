import { createContext, useContext } from 'react'

/** 클라우드(로그인) 모드의 세션. 로컬 개발 모드에서는 null */
export interface Session {
  email: string
  /** 토큰이 만료되어 다시 로그인이 필요함 */
  expired: boolean
  logout(reason?: string): Promise<void>
  /** 같은 계정으로 다시 로그인 (사용자 클릭에서 호출) */
  reauth(): Promise<void>
  /** Drive에서 다시 불러오기 (충돌 해결: 다른 기기 데이터 사용) */
  reload(): Promise<void>
  /** 충돌 해결: 내 데이터로 덮어쓰기 */
  forceSave(): Promise<void>
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session | null {
  return useContext(SessionContext)
}
