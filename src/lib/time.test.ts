import { describe, expect, it } from 'vitest'
import { DEFAULT_WORK_TYPES } from './defaults'
import { leaveEntry, workEntry } from '../test/fixtures'
import {
  calculateElapsedMinutes,
  calculateNetMinutes,
  formatMinutes,
  minutesWithinDailyRange,
  monthRange,
  summarizeWork,
  weekRange,
} from './time'

describe('근무시간 계산', () => {
  it('09:00~18:00, 휴게 60분 → 경과 9시간, 실근무 8시간', () => {
    const entry = workEntry()
    expect(calculateElapsedMinutes(entry)).toBe(540)
    expect(calculateNetMinutes(entry)).toBe(480)
  })

  it('자정을 넘기는 22:00~다음 날 06:00, 휴게 30분 → 실근무 7시간 30분', () => {
    const entry = workEntry({ startTime: '22:00', endTime: '06:00', endsNextDay: true, breakMinutes: 30 })
    expect(calculateElapsedMinutes(entry)).toBe(480)
    expect(calculateNetMinutes(entry)).toBe(450)
  })

  it('23:30~다음 날 00:15 → 45분', () => {
    expect(calculateElapsedMinutes({ startTime: '23:30', endTime: '00:15', endsNextDay: true })).toBe(45)
  })

  it('다음 날 종료 없이 종료가 더 이르면 음수(잘못된 입력)', () => {
    expect(calculateElapsedMinutes({ startTime: '22:00', endTime: '06:00', endsNextDay: false })).toBeLessThan(0)
  })

  it('시간·분 형식으로 표시한다', () => {
    expect(formatMinutes(480)).toBe('8시간')
    expect(formatMinutes(450)).toBe('7시간 30분')
    expect(formatMinutes(45)).toBe('45분')
    expect(formatMinutes(0)).toBe('0분')
  })
})

describe('기간', () => {
  it('월 범위 — 윤년 2월', () => {
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('월요일 시작 주 범위 — 연도 경계', () => {
    expect(weekRange('2026-10-18', 1)).toEqual({ start: '2026-10-12', end: '2026-10-18' })
    expect(weekRange('2027-01-01', 1)).toEqual({ start: '2026-12-28', end: '2027-01-03' })
    expect(weekRange('2026-10-18', 0)).toEqual({ start: '2026-10-18', end: '2026-10-24' })
  })
})

describe('summarizeWork', () => {
  const types = [...DEFAULT_WORK_TYPES]

  it('휴무와 휴가는 합계에서 빼고 유형별로 합산한다', () => {
    const entries = [
      workEntry({ id: 'a', date: '2026-10-19', endDate: '2026-10-19' }), // 8h
      workEntry({ id: 'b', date: '2026-10-20', endDate: '2026-10-20', workTypeId: 'flex', breakMinutes: 0 }), // 9h
      workEntry({ id: 'c', date: '2026-10-21', endDate: '2026-10-21', workTypeId: 'off' }),
      leaveEntry({ id: 'd' }),
    ]
    const summary = summarizeWork(entries, types, { start: '2026-10-01', end: '2026-10-31' })
    expect(summary.netMinutes).toBe(17 * 60)
    expect(summary.breakMinutes).toBe(60)
    expect(summary.entryCount).toBe(2)
    expect(summary.workDays).toBe(2)
    expect(summary.byType.map((row) => [row.workTypeId, row.netMinutes])).toEqual([
      ['work', 480],
      ['flex', 540],
    ])
  })

  it('자정 넘김 근무는 시작일 기준으로 기간에 포함한다', () => {
    const entries = [
      workEntry({ date: '2026-10-31', endDate: '2026-11-01', startTime: '22:00', endTime: '06:00', endsNextDay: true, breakMinutes: 0 }),
    ]
    expect(summarizeWork(entries, types, monthRange('2026-10')).netMinutes).toBe(480)
    expect(summarizeWork(entries, types, monthRange('2026-11')).netMinutes).toBe(0)
  })
})

describe('minutesWithinDailyRange', () => {
  const night = { start: '22:00', end: '06:00' }

  it('야간 시간대와 겹치는 분을 센다', () => {
    const entry = workEntry({ startTime: '20:00', endTime: '07:00', endsNextDay: true, endDate: '2026-10-20' })
    expect(minutesWithinDailyRange(entry, night)).toBe(8 * 60)
  })

  it('이른 아침 근무도 전날 시작한 시간대에 포함된다', () => {
    const entry = workEntry({ startTime: '04:00', endTime: '09:00' })
    expect(minutesWithinDailyRange(entry, night)).toBe(120)
  })

  it('겹치지 않으면 0', () => {
    expect(minutesWithinDailyRange(workEntry(), night)).toBe(0)
  })
})
