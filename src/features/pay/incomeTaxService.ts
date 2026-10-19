import { TAX_TABLE, type TaxTable } from '../../lib/taxTable'

/**
 * 근로소득 간이세액표로 월 소득세·지방소득세(원천징수 예상액)를 계산한다.
 * 출처: 국세청 근로소득 간이세액표(소득세법 시행령 별표2) — src/lib/tax_table.json의 effectiveFrom 시행분.
 * 예상치이며, 실제 원천징수액은 회사 신청 비율(80·100·120%)·비과세 처리에 따라 다를 수 있다. 여기서는 100%로 계산한다.
 */
export interface TaxResult {
  /** 소득세 (간이세액표 − 자녀 공제) */
  incomeTax: number
  /** 지방소득세 = 소득세 × 10%, 10원 미만 절사 */
  localIncomeTax: number
}

const MAX_FAMILY_COLUMN = 11
const TABLE_BASE_MAX = 10_000_000

/** 원천징수 세액의 10원 미만은 버린다 */
const floor10 = (won: number) => Math.floor(won / 10) * 10

/** 가족 1~11명 세액 배열에서 해당 가족 수 세액. 11명 초과: 11명 세액 − (10명 세액 − 11명 세액) × 초과 인원 */
function taxForFamily(taxes: readonly number[], familyCount: number): number {
  const family = Math.max(1, Math.floor(familyCount))
  if (family <= MAX_FAMILY_COLUMN) return taxes[family - 1]
  const eleven = taxes[MAX_FAMILY_COLUMN - 1]
  const ten = taxes[MAX_FAMILY_COLUMN - 2]
  return Math.max(0, eleven - (ten - eleven) * (family - MAX_FAMILY_COLUMN))
}

/** 월급여(원)가 [min, max) 구간에 드는 행 (이진 탐색). 없으면 null */
function findRow(table: TaxTable, won: number): TaxTable['rows'][number] | null {
  let low = 0
  let high = table.rows.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const row = table.rows[mid]
    if (won < row.min) high = mid - 1
    else if (won >= row.max) low = mid + 1
    else return row
  }
  return null
}

/** 8세 이상 20세 이하 자녀 공제 */
export function childTaxCredit(childCount: number, table: TaxTable = TAX_TABLE): number {
  const children = Math.max(0, Math.floor(childCount))
  if (children === 0) return 0
  if (children === 1) return table.childCredit.one
  return table.childCredit.two + (children - 2) * table.childCredit.perExtra
}

/** 간이세액표 세액(자녀 공제 전). 표가 다루지 않는 금액이면 RangeError */
export function tableIncomeTax(taxableMonthly: number, familyCount: number, table: TaxTable = TAX_TABLE): number {
  const won = Math.max(0, Math.floor(taxableMonthly))
  if (won < table.rows[0].min) return 0 // 표 시작(770천원) 미만은 세액 없음
  const row = findRow(table, won)
  if (row) return taxForFamily(row.tax, familyCount)
  if (table.at10000k && won >= TABLE_BASE_MAX) {
    const base = taxForFamily(table.at10000k, familyCount)
    if (won === TABLE_BASE_MAX) return base
    const bracket = table.brackets.find((item) => won > item.over && (item.upTo === null || won <= item.upTo))
    if (bracket) return floor10(base + bracket.fixed + ((won - bracket.over) * bracket.factorPercent * bracket.ratePercent) / 10_000)
  }
  throw new RangeError(`간이세액표(${table.effectiveFrom})에 월급여 ${won.toLocaleString('ko-KR')}원 구간이 없습니다.`)
}

/**
 * 월 소득세·지방소득세.
 * @param taxableMonthly 월별 과세급여액(원) — 비과세 제외
 * @param familyCount 공제대상 가족 수 (본인 포함)
 * @param childCount 공제대상 가족 중 8세 이상 20세 이하 자녀 수
 */
export function calculateTaxes(taxableMonthly: number, familyCount: number, childCount = 0, table: TaxTable = TAX_TABLE): TaxResult {
  const incomeTax = Math.max(0, tableIncomeTax(taxableMonthly, familyCount, table) - childTaxCredit(childCount, table))
  // 소득세 × 10%를 10원 단위로 절사 (부동소수점 오차가 없도록 정수 연산)
  return { incomeTax, localIncomeTax: Math.floor(incomeTax / 100) * 10 }
}
