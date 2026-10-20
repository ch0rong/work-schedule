import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { leaveEntry, sampleData, workEntry } from '../../test/fixtures'
import { buildHolidayMap } from '../../lib/holidays'
import { regularWorkDots, toCalendarEvents } from './calendarEvents'
import { ScheduleCalendar } from './ScheduleCalendar'

describe('toCalendarEvents', () => {
  it('근무는 시작·종료 일시, 휴가는 종일(종료일 다음 날 배타적)로 바꾼다', () => {
    const data = sampleData({
      entries: [
        workEntry({ id: 'n', startTime: '22:00', endTime: '06:00', endsNextDay: true, endDate: '2026-10-20' }),
        leaveEntry({ id: 'l', date: '2026-12-30', endDate: '2026-12-31', minutes: 960 }),
      ],
    })
    const [work, leave] = toCalendarEvents(data)
    expect(work).toMatchObject({ id: 'n', title: '정규 근무', start: '2026-10-19T22:00', end: '2026-10-20T06:00', allDay: false })
    expect(leave).toMatchObject({ id: 'l', title: '연차', start: '2026-12-30', end: '2027-01-01', allDay: true })
  })
})

describe('월간 보기 정규 근무 간략 표시', () => {
  it('정규 근무는 이벤트 없이 점, 연장이 있으면 연장만, 다른 근무 유형은 그대로', () => {
    const data = sampleData({
      entries: [
        workEntry({ id: 'r' }),
        workEntry({ id: 'o', date: '2026-10-20', endDate: '2026-10-20', overtime: [{ startTime: '18:00', endTime: '19:30', endsNextDay: false }] }),
        workEntry({ id: 'f', date: '2026-10-21', endDate: '2026-10-21', workTypeId: 'flex' }),
      ],
    })
    expect(toCalendarEvents(data, { compactRegular: true }).map((event) => [event.id, event.title])).toEqual([
      ['o', '연장 +1:30'],
      ['f', '유연근무'],
    ])
    expect(toCalendarEvents(data).map((event) => event.title)).toEqual(['정규 근무', '정규 근무 +1:30', '유연근무'])
    expect([...regularWorkDots(data).keys()]).toEqual(['2026-10-19', '2026-10-20'])
  })
})

describe('휴일근무 달력 라벨', () => {
  it('유형명만 표시하고 남은 연장 구간(+1:00)은 붙이지 않는다', () => {
    const entry = workEntry({
      workTypeId: 'holiday-work',
      date: '2026-09-13',
      endDate: '2026-09-13',
      holidayCompensation: 'comp-leave',
      overtime: [{ startTime: '18:00', endTime: '19:00', endsNextDay: false }],
    })
    expect(toCalendarEvents(sampleData({ entries: [entry] }))[0].title).toBe('휴일근무')
  })
})

describe('ScheduleCalendar', () => {
  it('월간(점)·주간(시간 막대) 보기 모두 같은 날짜에 일정을 표시하고, 클릭하면 일정 ID를 넘긴다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 19, 10, 0))
    const onEventClick = vi.fn()
    const data = sampleData({ entries: [workEntry({ id: 'w1', date: '2026-10-21', endDate: '2026-10-21' })] })
    render(
      <ScheduleCalendar data={data} selectedDate="2026-10-19" holidays={new Map()} mealDates={new Set()} dayNotes={{}} onDateClick={() => {}} onEventClick={onEventClick} onRangeChange={() => {}} />,
    )

    expect(await screen.findByRole('heading', { name: '2026년 10월' })).toBeInTheDocument()
    const monthDot = screen.getByTitle('정규 근무')
    expect(monthDot.closest('[data-date]')).toHaveAttribute('data-date', '2026-10-21')

    await userEvent.click(screen.getByRole('button', { name: '주간' }))
    const weekEvent = await screen.findByText('정규 근무')
    expect(weekEvent.closest('[data-date]')).toHaveAttribute('data-date', '2026-10-21')

    await userEvent.click(weekEvent)
    expect(onEventClick).toHaveBeenCalledWith('w1')
    vi.useRealTimers()
  })
})

describe('주말·공휴일 표시', () => {
  it('일요일부터 시작하고, 토요일·일요일·공휴일 칸을 구분한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 19, 10, 0))
    const data = sampleData({ entries: [] })
    const holidays = buildHolidayMap([])
    render(
      <ScheduleCalendar data={data} selectedDate="2026-10-19" holidays={holidays} mealDates={new Set()} dayNotes={{}} onDateClick={() => {}} onEventClick={() => {}} onRangeChange={() => {}} />,
    )
    await screen.findByRole('heading', { name: '2026년 10월' })
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0]).toHaveTextContent('일')
    expect(headers[0]).toHaveClass('is-sun')
    expect(headers[6]).toHaveClass('is-sat')
    const cell = (date: string) => document.querySelector(`.calendar [data-date="${date}"]`)!
    expect(cell('2026-10-17')).toHaveClass('is-sat')
    expect(cell('2026-10-18')).toHaveClass('is-sun')
    expect(cell('2026-10-03')).toHaveClass('is-sat', 'is-holiday') // 개천절(토) → 빨간 날짜
    expect(cell('2026-10-05')).toHaveClass('is-holiday') // 대체공휴일(월)
    expect(cell('2026-10-14')).not.toHaveClass('is-sat', 'is-sun', 'is-holiday')
    vi.useRealTimers()
  })
})
