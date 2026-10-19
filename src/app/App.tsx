import { useCallback, useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CalendarDays, CalendarHeart, Palmtree, UserCog, Wallet } from 'lucide-react'
import { CalendarPage } from '../components/calendar/CalendarPage'
import { ErrorMessage } from '../components/common/ErrorMessage'
import { HolidayPage } from '../components/holidays/HolidayPage'
import { LeavePage } from '../components/leave/LeavePage'
import { MyPage } from '../components/mypage/MyPage'
import { PayPage } from '../components/pay/PayPage'
import { DataRecovery } from '../components/settings/DataRecovery'
import type { AppStore } from '../lib/store'
import { NoticeContext } from './noticeContext'
import { SessionAlerts, SessionBar } from './SessionBar'
import { StoreContext, useAppState } from './storeContext'

type ViewId = 'calendar' | 'leave' | 'pay' | 'holidays' | 'mypage'

const NAV_ITEMS: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: 'calendar', label: '달력', icon: CalendarDays },
  { id: 'leave', label: '연차·대체휴무', icon: Palmtree },
  { id: 'pay', label: '월별 급여', icon: Wallet },
  { id: 'holidays', label: '공휴일', icon: CalendarHeart },
  { id: 'mypage', label: '마이페이지', icon: UserCog },
]

const NOTICE_DURATION_MS = 3000

export default function App({ store }: { store: AppStore }) {
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null)
  const notify = useCallback((message: string) => setNotice({ id: Date.now(), message }), [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  return (
    <StoreContext.Provider value={store}>
      <NoticeContext.Provider value={notify}>
        <AppShell />
        <div className="notice-region" role="status" aria-live="polite">
          {notice && (
            <p key={notice.id} className="notice">
              {notice.message}
            </p>
          )}
        </div>
      </NoticeContext.Provider>
    </StoreContext.Provider>
  )
}

function AppShell() {
  const state = useAppState()
  const [view, setView] = useState<ViewId>('calendar')
  const current = NAV_ITEMS.find((item) => item.id === view)!

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">근무 스케줄</h1>
        <SessionBar />
      </header>

      <nav className="app-nav" aria-label="주요 메뉴">
        <ul>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                className="nav-button"
                aria-current={view === id ? 'page' : undefined}
                onClick={() => setView(id)}
                disabled={state.invalid !== null}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="app-main">
        <SessionAlerts />
        {state.storageWarning && <ErrorMessage title={state.storageWarning} />}
        {state.saveError && (
          <ErrorMessage title={state.saveError} messages={['마이페이지에서 JSON 백업을 내려받아 데이터를 보관하세요.']} />
        )}

        {state.invalid ? (
          <>
            <h2 className="page-title">데이터 복구</h2>
            <DataRecovery errors={state.invalid.errors} />
          </>
        ) : (
          <>
            <h2 className="page-title">{current.label}</h2>
            {view === 'calendar' && <CalendarPage />}
            {view === 'leave' && <LeavePage />}
            {view === 'pay' && <PayPage />}
            {view === 'holidays' && <HolidayPage />}
            {view === 'mypage' && <MyPage />}
          </>
        )}
      </main>
    </div>
  )
}
