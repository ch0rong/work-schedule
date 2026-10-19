import { describe, expect, it } from 'vitest'
import { createDefaultPayProfile } from '../../lib/defaults'
import type { AppData, PayProfile } from '../../lib/schema'
import { overtimeEntry, sampleData, tripEntry, workEntry } from '../../test/fixtures'
import { paydayDate } from './payday'
import { computeDeductions, estimateMonthlyPay, formatWon, profileForMonth } from './payService'

const noHoliday = () => false

function withProfile(data: AppData, patch: Partial<PayProfile>): AppData {
  const profile = { ...createDefaultPayProfile('2026-01'), ...patch }
  return { ...data, settings: { ...data.settings, pay: { ...data.settings.pay, profiles: [profile] } } }
}

describe('급여 지급일', () => {
  it('25일이 평일이면 그대로', () => {
    expect(paydayDate('2026-09', 25, noHoliday)).toBe('2026-09-25') // 금
  })

  it('토요일이면 금요일, 일요일이면 금요일', () => {
    expect(paydayDate('2026-04', 25, noHoliday)).toBe('2026-04-24') // 4/25 토
    expect(paydayDate('2026-10', 25, noHoliday)).toBe('2026-10-23') // 10/25 일
  })

  it('공휴일이면 직전 영업일, 연휴가 이어지면 더 앞당김', () => {
    expect(paydayDate('2026-12', 25, (date) => date === '2026-12-25')).toBe('2026-12-24')
    expect(paydayDate('2026-09', 25, (date) => ['2026-09-24', '2026-09-25'].includes(date))).toBe('2026-09-23')
  })

  it('급여일이 말일보다 크면 말일', () => {
    expect(paydayDate('2026-02', 31, noHoliday)).toBe('2026-02-27') // 2/28 토
  })
})

describe('급여 설정 이력', () => {
  const profiles = [
    { ...createDefaultPayProfile('2026-01'), id: 'a', baseSalary: 2_000_000 },
    { ...createDefaultPayProfile('2026-07'), id: 'b', baseSalary: 2_100_000 },
  ]

  it('적용 시작 월 기준으로 고른다', () => {
    expect(profileForMonth(profiles, '2026-06').id).toBe('a')
    expect(profileForMonth(profiles, '2026-07').id).toBe('b')
    expect(profileForMonth(profiles, '2025-12').id).toBe('a') // 첫 설정 이전은 첫 설정
  })
})

describe('공제', () => {
  it('금액·요율·다른 공제 기준(장기요양 = 건강보험 × 요율)', () => {
    const lines = computeDeductions(
      [
        { id: 'pension', name: '국민연금', method: 'rate', value: 4.5, base: 'base-salary' },
        { id: 'health', name: '건강보험', method: 'rate', value: 3.5, base: 'base-salary' },
        { id: 'ltc', name: '장기요양', method: 'rate', value: 10, base: 'deduction:health' },
        { id: 'etc', name: '기타', method: 'amount', value: 12345, base: 'base-salary' },
      ],
      { 'base-salary': 2_000_000, 'fixed-pay': 2_100_000, gross: 2_200_000 },
      'round',
    )
    expect(lines.map((line) => line.amount)).toEqual([90000, 70000, 7000, 12345])
  })

  it('10원 미만 절사 옵션', () => {
    const [line] = computeDeductions(
      [{ id: 'x', name: 'x', method: 'rate', value: 3.545, base: 'base-salary' }],
      { 'base-salary': 2_345_678, 'fixed-pay': 0, gross: 0 },
      'floor10',
    )
    expect(line.amount).toBe(83150) // 83154.28 → 83150
  })
})

describe('월 예상 급여', () => {
  it('기본급 + 수당 + 연장(산정 기간) + 휴일근무 수당 − 공제, 출장비는 별도', () => {
    const data = withProfile(
      sampleData({
        entries: [
          overtimeEntry('o1', '2026-08-25', '18:00', '19:30'), // 9월 급여
          overtimeEntry('o2', '2026-09-22', '18:00', '19:00'), // 10월 급여
          workEntry({ id: 'h', workTypeId: 'holiday-work', date: '2026-09-06', endDate: '2026-09-06', holidayCompensation: 'allowance' }),
          tripEntry({ date: '2026-09-10', endDate: '2026-09-10' }),
        ],
      }),
      {
        baseSalary: 2_000_000,
        items: [
          { id: 'transport', name: '교통비', amount: 100_000, taxFree: false },
          { id: 'meal', name: '식비', amount: 140_000, taxFree: true },
        ],
        deductions: [{ id: 'pension', name: '국민연금', method: 'amount', value: 90_000, base: 'base-salary' }],
      },
    )
    const pay = estimateMonthlyPay(data, '2026-09', noHoliday)
    expect(pay.earnings.find((line) => line.key === 'overtime')?.amount).toBe(27075)
    expect(pay.earnings.find((line) => line.key === 'holiday-allowance')?.amount).toBe(135375)
    expect(pay.gross).toBe(2_000_000 + 240_000 + 27075 + 135375)
    // 과세급여 = 2,402,450 − 비과세 식비 140,000 = 2,262,450원 → 간이세액표 [2,260,000, 2,270,000) 본인 1명 27,880원
    expect(pay.deductions.find((line) => line.key === 'auto-income-tax')).toMatchObject({ label: '소득세', amount: 27_880 })
    expect(pay.deductions.find((line) => line.key === 'auto-local-tax')).toMatchObject({ label: '지방소득세', amount: 2_780 })
    expect(pay.net).toBe(pay.gross - 90_000 - 27_880 - 2_780)
    expect(pay.travel.total).toBe(20000)
    expect(pay.payday).toBe('2026-09-25')
  })

  it('실제 입금액과 차액', () => {
    const data = withProfile(sampleData({ entries: [] }), { baseSalary: 2_000_000, items: [], deductions: [] })
    data.payrollRecords['2026-09'] = { actualDeposit: 1_990_000, note: '' }
    const pay = estimateMonthlyPay(data, '2026-09', noHoliday)
    // 예상 실수령 = 2,000,000 − 소득세 19,520 − 지방소득세 1,950 = 1,978,530원
    expect(pay.net).toBe(1_978_530)
    expect(pay.difference).toBe(1_990_000 - 1_978_530)
  })

  it('공제대상 가족·자녀 수 설정을 소득세 계산에 쓴다', () => {
    const data = withProfile(sampleData({ entries: [] }), { baseSalary: 2_500_000, items: [], deductions: [] })
    data.settings.tax = { familyCount: 2, childCount: 0 }
    expect(estimateMonthlyPay(data, '2026-09', noHoliday).deductions.find((line) => line.key === 'auto-income-tax')?.amount).toBe(28_600)
    data.settings.tax = { familyCount: 3, childCount: 1 }
    expect(estimateMonthlyPay(data, '2026-09', noHoliday).deductions.find((line) => line.key === 'auto-income-tax')?.amount).toBe(0) // 16,530원 − 자녀 공제 20,830원 < 0 → 0원
  })

  it('예전에 직접 입력한 소득세·지방소득세 공제는 값을 보존하되 계산에서 빼고 안내한다', () => {
    const data = withProfile(sampleData({ entries: [] }), {
      baseSalary: 2_000_000,
      items: [],
      deductions: [
        { id: 'income-tax', name: '소득세', method: 'amount', value: 50_000, base: 'gross' },
        { id: 'local-tax', name: '지방소득세', method: 'rate', value: 10, base: 'deduction:income-tax' },
      ],
    })
    const pay = estimateMonthlyPay(data, '2026-09', noHoliday)
    expect(pay.deductions.map((line) => line.key)).toEqual(['auto-income-tax', 'auto-local-tax'])
    expect(pay.net).toBe(1_978_530)
    expect(pay.notes.join(' ')).toContain('직접 입력했던 소득세·지방소득세 값은 사용하지 않고 자동 계산합니다')
    expect(pay.profile.deductions).toHaveLength(2) // 저장된 값은 그대로
  })
})

describe('formatWon', () => {
  it('천 단위 구분', () => {
    expect(formatWon(1234567)).toBe('1,234,567원')
  })
})
