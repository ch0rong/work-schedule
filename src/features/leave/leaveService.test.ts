import { describe, expect, it } from 'vitest'
import { appDataSchema, type Settings } from '../../lib/schema'
import { leaveEntry, sampleData } from '../../test/fixtures'
import {
  countWorkingDays,
  deductsAnnualLeave,
  defaultLeaveMinutes,
  formatLeaveAmount,
  getLeaveWarnings,
  leavePeriodFor,
  referenceGrant,
  summarizeAnnualLeave,
} from './leaveService'

const noHoliday = () => false
const withSettings = (patch: (settings: Settings) => void) => {
  const data = sampleData()
  patch(data.settings)
  return data.settings
}

describe('연차 일수·표시', () => {
  it('주말과 공휴일을 뺀 일수 (금~화 → 3일, 월요일이 공휴일이면 2일)', () => {
    expect(countWorkingDays('2026-10-23', '2026-10-27', noHoliday)).toBe(3)
    expect(countWorkingDays('2026-10-23', '2026-10-27', (date) => date === '2026-10-26')).toBe(2)
  })

  it('반차 4시간, 외출 기본 1시간, 여러 날 연차는 평일 수 × 8시간', () => {
    expect(defaultLeaveMinutes('half-am', '2026-10-23', '2026-10-23', 480, noHoliday)).toBe(240)
    expect(defaultLeaveMinutes('outing', '2026-10-23', '2026-10-23', 480, noHoliday)).toBe(60)
    expect(defaultLeaveMinutes('annual', '2026-10-23', '2026-10-27', 480, noHoliday)).toBe(1440)
  })

  it('일·시간 표시', () => {
    expect(formatLeaveAmount(480 * 13 + 240, 480)).toBe('13일 4시간')
    expect(formatLeaveAmount(90, 480)).toBe('1시간 30분')
    expect(formatLeaveAmount(0, 480)).toBe('0일')
    expect(formatLeaveAmount(-240, 480)).toBe('-4시간')
  })
})

describe('적용 규정별 차감', () => {
  it('외출·조퇴는 기본적으로 적용 규정과 상관없이 차감, 설정으로 끌 수 있다', () => {
    const labor = withSettings((s) => (s.regulation = 'labor-standards'))
    expect(deductsAnnualLeave('outing', labor)).toBe(true)
    expect(deductsAnnualLeave('early-leave', labor)).toBe(true)
    expect(deductsAnnualLeave('outing', withSettings((s) => (s.leave.outingDeducts = false)))).toBe(false)
  })

  it('특별휴가·대체휴무는 항상 미차감', () => {
    const settings = withSettings(() => {})
    expect(deductsAnnualLeave('special', settings)).toBe(false)
    expect(deductsAnnualLeave('comp', settings)).toBe(false)
  })

  it('외출·조퇴 설정이 없던 기존 데이터는 차감으로 불러온다', () => {
    const data = sampleData()
    const leave: Partial<Settings['leave']> = { ...data.settings.leave }
    delete leave.outingDeducts
    const parsed = appDataSchema.parse({ ...data, settings: { ...data.settings, leave } })
    expect(parsed.settings.leave.outingDeducts).toBe(true)
  })

  it('공가·병가는 설정에 따름', () => {
    expect(deductsAnnualLeave('sick', withSettings(() => {}))).toBe(false)
    expect(deductsAnnualLeave('sick', withSettings((s) => (s.leave.sickDeducts = true)))).toBe(true)
  })

  it('공무원: 외출 3시간 + 5시간 = 연차 1일 차감', () => {
    const data = sampleData({
      entries: [
        leaveEntry({ id: 'a', leaveType: 'outing', date: '2026-03-02', endDate: '2026-03-02', minutes: 180 }),
        leaveEntry({ id: 'b', leaveType: 'early-leave', date: '2026-03-03', endDate: '2026-03-03', minutes: 300 }),
        leaveEntry({ id: 'c', leaveType: 'half-pm', date: '2026-03-04', endDate: '2026-03-04', minutes: 240 }),
      ],
    })
    const summary = summarizeAnnualLeave(data, leavePeriodFor('2026-03-02', data.settings)!)
    expect(summary.usedMinutes).toBe(480 + 240)
    expect(formatLeaveAmount(summary.remainingMinutes, 480)).toBe('13일 4시간')
  })
})

describe('연차 부여 기간·참고값', () => {
  it('회계연도 기준은 1/1~12/31', () => {
    expect(leavePeriodFor('2026-10-19', sampleData().settings)).toEqual({ key: '2026', start: '2026-01-01', end: '2026-12-31' })
  })

  it('입사일 기준은 입사 기념일부터 1년', () => {
    const settings = withSettings((s) => {
      s.leave.basis = 'hire-date'
      s.leave.hireDate = '2024-05-10'
    })
    expect(leavePeriodFor('2026-03-01', settings)).toEqual({ key: '2025-05-10', start: '2025-05-10', end: '2026-05-09' })
    expect(leavePeriodFor('2026-05-10', settings)?.key).toBe('2026-05-10')
    expect(leavePeriodFor('2024-01-01', settings)).toBeNull()
  })

  it('입사일 기준 윤일(2/29) 입사', () => {
    const settings = withSettings((s) => {
      s.leave.basis = 'hire-date'
      s.leave.hireDate = '2024-02-29'
    })
    expect(leavePeriodFor('2025-03-01', settings)).toEqual({ key: '2025-02-28', start: '2025-02-28', end: '2026-02-27' })
  })

  it('공무원 연가일수표: 1월 1일 기준 재직 2년 → 15일, 5년 → 20일, 6년 → 21일', () => {
    const period = { key: '2026', start: '2026-01-01', end: '2026-12-31' }
    const at = (hireDate: string) => referenceGrant(period, withSettings((s) => (s.leave.hireDate = hireDate))).days
    expect(at('2026-03-02')).toBe(11) // 신규 임용 연도
    expect(at('2024-01-01')).toBe(15)
    expect(at('2023-01-01')).toBe(16)
    expect(at('2021-01-01')).toBe(20)
    expect(at('2019-06-01')).toBe(21)
  })

  it('근로기준법: 1년 이상 15일, 3년 이상 2년마다 +1, 최대 25일', () => {
    const period = { key: '2026', start: '2026-01-01', end: '2026-12-31' }
    const at = (hireDate: string) =>
      referenceGrant(
        period,
        withSettings((s) => {
          s.regulation = 'labor-standards'
          s.leave.hireDate = hireDate
        }),
      ).days
    expect(at('2025-01-01')).toBe(15)
    expect(at('2023-01-01')).toBe(16)
    expect(at('2000-01-01')).toBe(25)
    expect(at('2026-03-01')).toBe(9) // 3/1 입사 → 연말까지 9개월
  })

  it('직접 입력값과 추가 부여가 참고값보다 우선한다', () => {
    const data = sampleData({ entries: [] })
    data.settings.leave.hireDate = '2019-01-01'
    data.settings.leave.grants = { '2026': { days: 18, extraDays: 2, note: '' } }
    const summary = summarizeAnnualLeave(data, leavePeriodFor('2026-01-01', data.settings)!)
    expect(summary.reference.days).toBe(21)
    expect(summary.grantedMinutes).toBe(20 * 480)
  })

  it('잔여 연차를 넘기면 경고', () => {
    const data = sampleData({ entries: [] })
    data.settings.leave.grants = { '2026': { days: 1, extraDays: 0, note: '' } }
    expect(getLeaveWarnings(data, leaveEntry())).toEqual([])
    expect(getLeaveWarnings(data, leaveEntry({ minutes: 960, endDate: '2026-10-26' }))).toHaveLength(1)
    expect(getLeaveWarnings(data, leaveEntry({ leaveType: 'special', specialTypeId: 'other', minutes: 9600 }))).toEqual([])
  })
})
