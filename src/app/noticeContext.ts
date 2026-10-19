import { createContext, useContext } from 'react'

/** 저장 성공 등 짧은 피드백을 화면 하단에 띄운다. */
export const NoticeContext = createContext<(message: string) => void>(() => {})

export function useNotify() {
  return useContext(NoticeContext)
}
