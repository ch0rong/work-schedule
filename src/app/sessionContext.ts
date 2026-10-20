import { createContext, useContext } from 'react'

/** 클라우드(로그인) 모드의 세션. 로컬 개발 모드에서는 null */
export interface Session {
  email: string
  /** 토큰이 만료되어 다시 로그인이 필요함 */
  expired: boolean
  logout(reason?: string): Promise<void>
  /** 같은 계정으로 다시 로그인 (사용자 클릭에서 호출) */
  reauth(): Promise<void>
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session | null {
  return useContext(SessionContext)
}
