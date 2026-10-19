import { createContext, useContext } from 'react'

/** 설정 섹션이 저장하지 않은 변경이 있는지 마이페이지 탭에 알린다 (탭을 바꾸기 전 확인용) */
export const UnsavedChangesContext = createContext<(sectionId: string, dirty: boolean) => void>(() => {})

export function useReportUnsaved() {
  return useContext(UnsavedChangesContext)
}
