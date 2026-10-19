import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CalendarPreferences } from '../settings/CalendarPreferences'
import { DataManagement } from '../settings/DataManagement'
import { WorkTypeManager } from '../settings/WorkTypeManager'
import { PaySettings, TaxSettings } from './PaySettings'
import {
  CompLeaveSettings,
  LeaveBasisSettings,
  MealSettings,
  OvertimeSettings,
  RegulationSettings,
  ScheduleSettings,
  SessionSettings,
  TravelSettings,
} from './RuleSettings'
import { SpecialLeaveTypes } from './SpecialLeaveTypes'
import { UnsavedChangesContext } from './unsavedContext'

/** 마이페이지 탭: 선택한 탭의 섹션만 렌더링한다 */
const TABS = [
  { id: 'regulation', label: '적용 규정', render: () => <RegulationSettings /> },
  { id: 'pay', label: '급여·공제', render: () => <PaySettings /> },
  { id: 'tax', label: '세금', render: () => <TaxSettings /> },
  { id: 'schedule', label: '근무 기본시간', render: () => <ScheduleSettings /> },
  { id: 'overtime', label: '연장근무', render: () => <OvertimeSettings /> },
  { id: 'meal', label: '매식비', render: () => <MealSettings /> },
  { id: 'travel', label: '출장비', render: () => <TravelSettings /> },
  { id: 'comp', label: '대체휴무', render: () => <CompLeaveSettings /> },
  { id: 'leave-basis', label: '연차 기준', render: () => <LeaveBasisSettings /> },
  { id: 'special-leave', label: '특별휴가', render: () => <SpecialLeaveTypes /> },
  { id: 'work-types', label: '근무 유형', render: () => <WorkTypeManager /> },
  { id: 'calendar', label: '달력', render: () => <CalendarPreferences /> },
  { id: 'session', label: '로그인 세션', render: () => <SessionSettings /> },
  { id: 'data-management', label: '백업', render: () => <DataManagement /> },
] as const satisfies readonly { id: string; label: string; render: () => ReactNode }[]

export type MyPageTab = (typeof TABS)[number]['id']

export function MyPage() {
  // 처음 들어오면 첫 번째 탭(적용 규정)
  const [activeTab, setActiveTab] = useState<MyPageTab>(TABS[0].id)
  const tabRefs = useRef(new Map<MyPageTab, HTMLButtonElement>())
  const active = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const unsaved = useRef(new Set<string>())
  const reportUnsaved = useCallback((sectionId: string, dirty: boolean) => {
    if (dirty) unsaved.current.add(sectionId)
    else unsaved.current.delete(sectionId)
  }, [])

  /** 저장하지 않은 변경이 있으면 확인 후 탭을 바꾼다. 바꿨으면 true */
  function changeTab(next: MyPageTab): boolean {
    if (next === activeTab) return true
    if (unsaved.current.size > 0 && !window.confirm('저장하지 않은 변경이 있습니다. 다른 메뉴로 이동하면 변경 내용이 사라집니다. 이동할까요?')) return false
    unsaved.current.clear()
    setActiveTab(next)
    return true
  }

  /** 방향키·Home·End로 탭 이동 (WAI-ARIA 탭 패턴) */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null
    if (next === null) return
    event.preventDefault()
    if (changeTab(TABS[next].id)) tabRefs.current.get(TABS[next].id)?.focus()
  }

  return (
    <div className="mypage">
      <div role="tablist" aria-label="마이페이지 메뉴" className="mypage-tabs">
        {TABS.map((tab, index) => {
          const selected = tab.id === activeTab
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node)
                else tabRefs.current.delete(tab.id)
              }}
              type="button"
              role="tab"
              id={`mypage-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls="mypage-panel"
              tabIndex={selected ? 0 : -1}
              className={`mypage-tab ${selected ? 'is-active' : ''}`}
              onClick={() => changeTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {/* 선택한 탭만 렌더링한다 */}
      <div role="tabpanel" id="mypage-panel" aria-labelledby={`mypage-tab-${active.id}`} className="mypage-panel" key={active.id}>
        <UnsavedChangesContext.Provider value={reportUnsaved}>{active.render()}</UnsavedChangesContext.Provider>
      </div>
    </div>
  )
}
