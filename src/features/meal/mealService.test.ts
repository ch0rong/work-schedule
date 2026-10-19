import { describe, expect, it } from 'vitest'
import type { MealUsage } from '../../lib/schema'
import { overtimeEntry, sampleData, workEntry } from '../../test/fixtures'
import { mealOccurrenceDates, summarizeMeals, validateMealUsage } from './mealService'

const usage = (overrides: Partial<MealUsage> = {}): MealUsage => ({
  id: 'u1',
  sourceDate: '2026-10-05',
  usedDate: '2026-10-07',
  place: '구내식당',
  used: true,
  note: '',
  ...overrides,
})

describe('매식비', () => {
  const entries = [
    overtimeEntry('a', '2026-10-05', '18:00', '19:30'), // 발생
    overtimeEntry('b', '2026-10-06', '18:00', '18:30'), // 30분: 기준(60분) 미달
    workEntry({ id: 'c', date: '2026-10-07', endDate: '2026-10-07', overtime: [{ startTime: '07:00', endTime: '09:00', endsNextDay: false }] }), // 시작 전만
    overtimeEntry('d', '2026-10-20', '18:00', '20:00'), // 발생
    overtimeEntry('e', '2026-11-02', '18:00', '19:00'), // 다른 달
  ]

  it('근무 종료 후 연장 1시간 이상인 날만 발생, 월별 발생·사용·잔여', () => {
    const data = sampleData({ entries, mealUsages: [usage()] })
    const summary = summarizeMeals(data, '2026-10')
    expect(summary.occurrences.map((item) => item.date)).toEqual(['2026-10-05', '2026-10-20'])
    expect(summary).toMatchObject({ occurred: 2, used: 1, remaining: 1 })
    expect(summary.occurrences[0].usage?.place).toBe('구내식당')
  })

  it('발생일과 사용일이 달라도 발생 건과 연결된다', () => {
    const data = sampleData({ entries, mealUsages: [usage({ sourceDate: '2026-10-20', usedDate: '2026-10-28' })] })
    expect(summarizeMeals(data, '2026-10').occurrences[1].usage?.usedDate).toBe('2026-10-28')
  })

  it('이월 불가 설정이면 다음 달 사용을 거부, 허용하면 통과', () => {
    const data = sampleData({ entries })
    const nextMonth = usage({ usedDate: '2026-11-03' })
    expect(validateMealUsage(data, nextMonth)).toHaveLength(1)
    data.settings.meal.allowCarryOver = true
    expect(validateMealUsage(data, nextMonth)).toEqual([])
  })

  it('발생 건이 없는 날짜는 거부, 연장 삭제로 사라진 사용 내역은 연결 끊김으로 표시', () => {
    const data = sampleData({ entries, mealUsages: [usage({ sourceDate: '2026-10-06' })] })
    expect(validateMealUsage(data, usage({ sourceDate: '2026-10-06' }))).toHaveLength(1)
    expect(summarizeMeals(data, '2026-10').orphanUsages).toHaveLength(1)
  })

  it('기준 시간은 설정값', () => {
    const data = sampleData({ entries })
    data.settings.meal.minOvertimeMinutes = 30
    expect(summarizeMeals(data, '2026-10').occurred).toBe(3)
  })
})

describe('휴일근무 매식비', () => {
  const holiday = (id: string, endTime: string, breakMinutes = 0) =>
    workEntry({ id, workTypeId: 'holiday-work', date: '2026-10-11', endDate: '2026-10-11', startTime: '09:00', endTime, breakMinutes, holidayCompensation: 'allowance' })

  it('실근무 4시간 이상이면 매식비 1건, 미만이면 없음', () => {
    expect(mealOccurrenceDates(sampleData({ entries: [holiday('a', '13:00')] })).get('2026-10-11')).toBe('휴일근무 4시간')
    expect(mealOccurrenceDates(sampleData({ entries: [holiday('a', '12:30')] })).has('2026-10-11')).toBe(false)
  })

  it('휴게시간을 뺀 실근무로 판단한다', () => {
    expect(mealOccurrenceDates(sampleData({ entries: [holiday('a', '13:00', 30)] })).has('2026-10-11')).toBe(false)
  })

  it('보상이 대체휴무여도 매식비는 발생한다', () => {
    const entry = { ...holiday('a', '17:00'), holidayCompensation: 'comp-leave' as const }
    expect(summarizeMeals(sampleData({ entries: [entry] }), '2026-10').occurred).toBe(1)
  })

  it('기준은 설정값', () => {
    const data = sampleData({ entries: [holiday('a', '13:00')] })
    data.settings.meal.holidayMinWorkMinutes = 300
    expect(mealOccurrenceDates(data).size).toBe(0)
  })
})
