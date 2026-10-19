import { describe, expect, it } from 'vitest'
import { TAX_TABLE, taxTableSchema } from '../../lib/taxTable'
import mockTable from './__fixtures__/tax_table.mock.json'
import { calculateTaxes, childTaxCredit, tableIncomeTax } from './incomeTaxService'

/** 테스트용 목업: 실제 표의 200만~400만원 구간 일부 */
const MOCK = taxTableSchema.parse(mockTable)

describe('tax_table.json (국세청 엑셀 변환 결과)', () => {
  it('출처·시행일과 구간 구성', () => {
    expect(TAX_TABLE.effectiveFrom).toBe('2026-03-01')
    expect(TAX_TABLE.rows).toHaveLength(646)
    expect([TAX_TABLE.rows[0].min, TAX_TABLE.rows.at(-1)!.max]).toEqual([770_000, 10_000_000])
    expect(TAX_TABLE.brackets).toHaveLength(6)
  })

  it('구간이 빈틈없이 이어진다', () => {
    TAX_TABLE.rows.slice(1).forEach((row, index) => expect(row.min).toBe(TAX_TABLE.rows[index].max))
  })

  it('목업 행은 실제 표와 같은 값이다', () => {
    for (const row of MOCK.rows) expect(TAX_TABLE.rows.find((real) => real.min === row.min)).toEqual(row)
  })

  it('잘못된 표는 불러오지 않는다', () => {
    expect(taxTableSchema.safeParse({ ...mockTable, rows: [{ min: 0, max: 10, tax: [1, 2] }] }).success).toBe(false)
  })
})

describe('calculateTaxes — 목업 JSON(200만~400만원)에서 구간 찾기', () => {
  it('월 300만원, 본인 1명 → 소득세 74,350원, 지방소득세 7,430원', () => {
    expect(calculateTaxes(3_000_000, 1, 0, MOCK)).toEqual({ incomeTax: 74_350, localIncomeTax: 7_430 })
  })

  it('구간 [min, max): 3,019,999원은 300만원 구간, 가족 3명 31,940원', () => {
    expect(calculateTaxes(3_019_999, 3, 0, MOCK)).toEqual({ incomeTax: 31_940, localIncomeTax: 3_190 })
  })

  it('월 250만원, 가족 2명 → 28,600원 / 2,860원', () => {
    expect(calculateTaxes(2_500_000, 2, 0, MOCK)).toEqual({ incomeTax: 28_600, localIncomeTax: 2_860 })
  })

  it('세액 0원이면 지방소득세도 0원', () => {
    expect(calculateTaxes(2_000_000, 5, 0, MOCK)).toEqual({ incomeTax: 0, localIncomeTax: 0 })
  })

  it('목업에 없는 구간(빈틈)은 계산하지 않고 알린다', () => {
    expect(() => calculateTaxes(2_700_000, 1, 0, MOCK)).toThrow(RangeError)
  })

  it('표 시작(770천원) 미만은 0원', () => {
    expect(calculateTaxes(500_000, 1)).toEqual({ incomeTax: 0, localIncomeTax: 0 })
  })
})

describe('지방소득세 = 소득세 × 10%, 10원 미만 절사', () => {
  it('19,520원 → 1,950원 (1,952원에서 10원 미만 버림)', () => {
    expect(calculateTaxes(2_000_000, 1, 0, MOCK).localIncomeTax).toBe(1_950)
  })

  it('실제 표 전 구간에서 정확히 floor(소득세 / 100) × 10', () => {
    for (const row of TAX_TABLE.rows) {
      const { incomeTax, localIncomeTax } = calculateTaxes(row.min, 1)
      expect(localIncomeTax).toBe(Math.floor(incomeTax / 100) * 10)
    }
  })
})

describe('실제 표 — 10,000천원 이상·가족 11명 초과', () => {
  it('정확히 1,000만원은 표 값, 1,200만원은 계산식', () => {
    expect(tableIncomeTax(10_000_000, 1)).toBe(1_507_400)
    expect(tableIncomeTax(12_000_000, 1)).toBe(1_507_400 + 25_000 + 686_000) // 초과 200만원 × 98% × 35%
  })

  it('구간 경계(14,000천원)에서 계산식이 끊기지 않는다', () => {
    expect(tableIncomeTax(14_000_000, 1)).toBe(1_507_400 + 1_397_000)
  })

  it('가족 11명 초과: 11명 세액 − (10명 − 11명) × 초과 인원', () => {
    expect(tableIncomeTax(5_000_000, 12)).toBe(87_850 - (106_600 - 87_850))
  })
})

describe('자녀 공제', () => {
  it('8~20세 자녀 1명 20,830원, 2명 45,830원, 3명부터 1명당 33,330원 추가', () => {
    expect([0, 1, 2, 3].map((count) => childTaxCredit(count))).toEqual([0, 20_830, 45_830, 79_160])
  })

  it('공제 후 음수면 0원', () => {
    expect(calculateTaxes(3_000_000, 3, 1)).toEqual({ incomeTax: 31_940 - 20_830, localIncomeTax: 1_110 })
    expect(calculateTaxes(3_000_000, 4, 3).incomeTax).toBe(0)
  })
})
