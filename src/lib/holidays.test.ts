import { describe, expect, it } from 'vitest'
import { countWorkingDays } from '../features/leave/leaveService'
import { paydayDate } from '../features/pay/payday'
import { isWeekendDate, parseDateString } from './date'
import { OFFICIAL_HOLIDAYS } from './holidayData'
import { buildHolidayMap, isHolidayIn, renameOfficialHoliday } from './holidays'

describe('공휴일 데이터', () => {
  it('모든 날짜가 실제 날짜이고 해당 연도에 속하며 중복이 없다', () => {
    for (const [year, holidays] of Object.entries(OFFICIAL_HOLIDAYS)) {
      const dates = holidays.map((holiday) => holiday.date)
      expect(new Set(dates).size).toBe(dates.length)
      for (const date of dates) {
        expect(parseDateString(date)).not.toBeNull()
        expect(date.startsWith(`${year}-`)).toBe(true)
      }
    }
  })

  it('대체공휴일은 모두 평일이다', () => {
    for (const holidays of Object.values(OFFICIAL_HOLIDAYS)) {
      for (const holiday of holidays.filter((item) => item.substitute)) expect(isWeekendDate(holiday.date)).toBe(false)
    }
  })

  it('2026년: 제헌절은 공휴일, 노동절(시행 전)은 아님 / 2027년: 둘 다 공휴일', () => {
    const map = buildHolidayMap([])
    expect(isHolidayIn(map, '2026-07-17')).toBe(true)
    expect(isHolidayIn(map, '2026-05-01')).toBe(false)
    expect(isHolidayIn(map, '2027-05-01')).toBe(true)
    expect(isHolidayIn(map, '2027-05-03')).toBe(true)
  })

  it('사용자 추가 휴일을 구분해 합친다', () => {
    const map = buildHolidayMap([{ id: 'c', date: '2026-10-02', name: '임시공휴일' }])
    expect(map.get('2026-10-02')).toEqual([{ date: '2026-10-02', name: '임시공휴일', kind: 'custom' }])
    expect(map.get('2026-10-05')?.[0].kind).toBe('substitute')
  })
})

describe('공휴일을 반영한 계산', () => {
  const map = buildHolidayMap([])
  const isHoliday = (date: string) => isHolidayIn(map, date)

  it('급여일: 2026-09-25(추석) → 9/24(추석 연휴) → 9/23(수)', () => {
    expect(paydayDate('2026-09', 25, isHoliday)).toBe('2026-09-23')
  })

  it('급여일: 2027-12-25(토) → 12/24(금)', () => {
    expect(paydayDate('2027-12', 25, isHoliday)).toBe('2027-12-24')
  })

  it('추석 주간 연차 9/21~9/25 → 평일 중 공휴일 제외 3일', () => {
    expect(countWorkingDays('2026-09-21', '2026-09-25', isHoliday)).toBe(3)
  })

  it('추가 휴일도 급여일 계산에 반영된다', () => {
    const custom = buildHolidayMap([{ id: 'c', date: '2026-11-25', name: '임시공휴일' }])
    expect(paydayDate('2026-11', 25, (date) => isHolidayIn(custom, date))).toBe('2026-11-24')
  })
})

describe('법정공휴일 이름 수정', () => {
  it('이름만 바뀌고 휴일 여부는 그대로, 원래 이름을 기억한다', () => {
    const overrides = renameOfficialHoliday([], '2026-12-25', '기독탄신일', '성탄절')
    expect(overrides).toEqual([{ date: '2026-12-25', originalName: '기독탄신일', name: '성탄절' }])
    const map = buildHolidayMap([], overrides)
    expect(map.get('2026-12-25')).toEqual([{ date: '2026-12-25', name: '성탄절', kind: 'official', originalName: '기독탄신일' }])
    expect(isHolidayIn(map, '2026-12-25')).toBe(true)
    expect(map.get('2027-12-25')?.[0].name).toBe('기독탄신일') // 다른 해는 그대로
  })

  it('다시 고치면 덮어쓰고, 원래 이름이나 빈 이름이면 수정 기록을 지운다', () => {
    let overrides = renameOfficialHoliday([], '2026-12-25', '기독탄신일', '성탄절')
    overrides = renameOfficialHoliday(overrides, '2026-12-25', '기독탄신일', ' 크리스마스 ')
    expect(overrides).toEqual([{ date: '2026-12-25', originalName: '기독탄신일', name: '크리스마스' }])
    expect(renameOfficialHoliday(overrides, '2026-12-25', '기독탄신일', '기독탄신일')).toEqual([])
    expect(renameOfficialHoliday(overrides, '2026-12-25', '기독탄신일', '  ')).toEqual([])
  })
})
