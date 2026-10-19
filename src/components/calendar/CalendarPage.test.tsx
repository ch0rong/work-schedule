import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoticeContext } from '../../app/noticeContext'
import { StoreContext } from '../../app/storeContext'
import { createAppStore } from '../../lib/store'
import { FIXED_NOW, memoryStorage } from '../../test/fixtures'
import { CalendarPage } from './CalendarPage'

// jsdom은 레이아웃을 계산하지 않아 FullCalendar의 날짜 클릭을 낼 수 없으므로, 달력 부분만 대신한다
vi.mock('./ScheduleCalendar', () => ({
  ScheduleCalendar: ({ onDateClick }: { onDateClick: (date: string, startTime?: string) => void }) => (
    <div>
      <button type="button" onClick={() => onDateClick('2026-10-15')}>
        10/15 칸
      </button>
      <button type="button" onClick={() => onDateClick('2026-10-16', '14:00')}>
        10/16 14시 칸
      </button>
    </div>
  ),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 19, 10, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CalendarPage 날짜 클릭', () => {
  it('날짜(주간 보기의 시간 칸 포함)를 누르면 추가 창 없이 그 날짜로 이동한다', async () => {
    const store = createAppStore(memoryStorage(), () => FIXED_NOW)
    render(
      <StoreContext.Provider value={store}>
        <NoticeContext.Provider value={() => {}}>
          <CalendarPage />
        </NoticeContext.Provider>
      </StoreContext.Provider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '10/15 칸' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /10월 15일/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '10/16 14시 칸' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /10월 16일/ })).toBeInTheDocument()
  })
})
