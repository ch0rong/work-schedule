import { describe, expect, it } from 'vitest'
import { sampleData, workEntry } from '../../test/fixtures'
import { compGrants } from '../leave/compLeaveService'
import { capUsage, getOvertimeLimitErrors, summarizeOvertime } from '../overtime/overtimeService'
import { defaultShift } from '../schedules/scheduleService'
import { holidayWorkResult } from './holidayWorkService'

/** 9/13(일) 휴일근무. 휴게는 직접 입력 */
const holiday = (id: string, startTime: string, endTime: string, breakMinutes: number, holidayCompensation: 'allowance' | 'comp-leave' | 'trip-comp') =>
  workEntry({ id, workTypeId: 'holiday-work', date: '2026-09-13', endDate: '2026-09-13', startTime, endTime, breakMinutes, holidayCompensation })
const settings = sampleData().settings

describe('휴일근무 — 실근무 = 종료 − 시작 − 입력한 휴게', () => {
  it('점심 없이 09:00~13:00 → 4시간 (휴게를 임의로 빼지 않는다)', () => {
    expect(holidayWorkResult(holiday('a', '09:00', '13:00', 0, 'allowance'), settings).netMinutes).toBe(240)
  })

  it('휴게를 입력하면 그만큼 뺀다: 09:00~18:00, 휴게 60분 → 8시간', () => {
    expect(holidayWorkResult(holiday('a', '09:00', '18:00', 60, 'allowance'), settings).netMinutes).toBe(480)
  })

  it('휴일근무 기본 시간은 휴게 0, 시작 + 8시간', () => {
    expect(defaultShift('holiday-work', settings)).toEqual({ startTime: '09:00', endTime: '17:00', endsNextDay: false, breakMinutes: 0 })
  })
})

describe('8시간 미만 (7.5시간 포함) — 무조건 수당', () => {
  it('4시간 → 4시간 × 18,050원 = 72,200원, 대체휴무 없음', () => {
    const entry = holiday('a', '09:00', '13:00', 0, 'comp-leave') // 대체휴무를 골라 두었어도
    expect(holidayWorkResult(entry, settings)).toMatchObject({ fullDay: false, compensation: 'allowance', allowanceMinutes: 240, countsTowardCap: true, earnsCompLeave: false })
    const data = sampleData({ entries: [entry] })
    expect(summarizeOvertime(data, '2026-09').holidayAllowance).toEqual({ count: 1, minutes: 240, amount: 72200 })
    expect(compGrants(data)).toEqual([])
  })

  it('딱 7.5시간 → 7.5시간 × 18,050원 = 135,375원, 대체휴무·출장 선택 불가', () => {
    for (const choice of ['comp-leave', 'trip-comp'] as const) {
      const entry = holiday('a', '09:00', '16:30', 0, choice)
      expect(holidayWorkResult(entry, settings)).toMatchObject({ netMinutes: 450, compensation: 'allowance', allowanceMinutes: 450, earnsCompLeave: false })
      expect(summarizeOvertime(sampleData({ entries: [entry] }), '2026-09').holidayAllowance.amount).toBe(135375)
    }
  })

  it('8시간 미만 수당은 설정과 관계없이 월·주 연장 한도에 포함된다', () => {
    const data = sampleData({ entries: [holiday('a', '09:00', '13:00', 0, 'allowance')] })
    expect(data.settings.overtime.holidayAllowanceCountsTowardCap).toBe(false)
    expect(capUsage(data, '2026-09-13')).toMatchObject({ month: { countedMinutes: 240 }, week: { countedMinutes: 240 } })
  })

  it('주 한도가 찬 주에는 8시간 미만 휴일근무를 저장할 수 없다', () => {
    const week = ['07', '08', '09', '10', '11', '12'].map((day) =>
      workEntry({ id: `w${day}`, date: `2026-09-${day}`, endDate: `2026-09-${day}`, overtime: [{ startTime: '18:00', endTime: '20:00', endsNextDay: false }] }),
    )
    const data = sampleData({ entries: week })
    expect(getOvertimeLimitErrors(data, holiday('a', '09:00', '13:00', 0, 'allowance'))).toEqual([expect.stringContaining('주 한도')])
    // 8시간 출장(대체휴무)은 한도 제외라 저장 가능
    expect(getOvertimeLimitErrors(data, holiday('t', '09:00', '17:00', 0, 'trip-comp'))).toEqual([])
  })

  it('시간당 수당 설정을 바꾸면 그 단가로 계산한다 (하드코딩 없음)', () => {
    const data = sampleData({ entries: [holiday('a', '09:00', '13:00', 0, 'allowance')] })
    data.settings.overtime.hourlyRate = 20000
    expect(summarizeOvertime(data, '2026-09').holidayAllowance.amount).toBe(80000)
  })
})

describe('8시간 이상 — 대체휴무 / 수당 / 출장(대체휴무) 선택', () => {
  it('대체휴무 선택 → 대체휴무 1일, 수당 0원, 한도 제외', () => {
    const data = sampleData({ entries: [holiday('a', '09:00', '17:00', 0, 'comp-leave')] })
    expect(compGrants(data).map((grant) => grant.minutes)).toEqual([480])
    expect(summarizeOvertime(data, '2026-09').holidayAllowance).toEqual({ count: 0, minutes: 0, amount: 0 })
    expect(capUsage(data, '2026-09-13').week.countedMinutes).toBe(0)
  })

  it('수당 선택 → 8시간이 아니라 7.5시간 × 18,050원 = 135,375원', () => {
    const data = sampleData({ entries: [holiday('a', '09:00', '17:00', 0, 'allowance')] })
    expect(summarizeOvertime(data, '2026-09').holidayAllowance).toEqual({ count: 1, minutes: 450, amount: 135375 })
    expect(compGrants(data)).toEqual([])
  })

  it('출장(대체휴무) → 수당 없이 대체휴무 1일', () => {
    const data = sampleData({ entries: [holiday('a', '09:00', '17:00', 0, 'trip-comp')] })
    expect(compGrants(data).map((grant) => [grant.reason, grant.minutes])).toEqual([['휴일 출장', 480]])
    expect(summarizeOvertime(data, '2026-09').holidayAllowance.amount).toBe(0)
  })

  it('10시간 근무해도 8시간까지만 인정: 수당은 7.5시간, 초과 2시간은 버린다', () => {
    const entry = holiday('a', '08:00', '18:00', 0, 'allowance')
    expect(holidayWorkResult(entry, settings)).toMatchObject({ netMinutes: 600, recognizedMinutes: 480, droppedMinutes: 120, allowanceMinutes: 450 })
    expect(summarizeOvertime(sampleData({ entries: [entry] }), '2026-09')).toMatchObject({ overtimeMinutes: 0, holidayAllowance: { amount: 135375 } })
  })

  it('휴일근무에 남아 있는 연장근무 구간은 수당·한도에 넣지 않는다', () => {
    const entry = { ...holiday('a', '09:00', '17:00', 0, 'comp-leave'), overtime: [{ startTime: '17:00', endTime: '19:00', endsNextDay: false }] }
    const data = sampleData({ entries: [entry] })
    expect(summarizeOvertime(data, '2026-09')).toMatchObject({ overtimeMinutes: 0, overtimeAmount: 0 })
    expect(capUsage(data, '2026-09-13').week.countedMinutes).toBe(0)
  })
})
