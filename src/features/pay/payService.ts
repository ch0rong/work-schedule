import type { AppData, Deduction, PayProfile, PayrollRecord, Settings } from '../../lib/schema'
import { formatMinutes } from '../../lib/time'
import { TAX_TABLE } from '../../lib/taxTable'
import { summarizeOvertime, type OvertimeSummary } from '../overtime/overtimeService'
import { calculateTaxes } from './incomeTaxService'
import { monthlyTravel, type MonthlyTravel } from '../travel/travelService'
import { paydayDate } from './payday'

export const PAY_DISCLAIMER =
  '예상 급여는 입력한 급여·공제·근무 기록만으로 계산한 추정치입니다. 4대보험 요율·세금을 임의로 추정하지 않으며, 실제 지급액과 다를 수 있습니다.'

export const DEDUCTION_BASE_LABELS: Record<string, string> = {
  'base-salary': '기본급',
  'fixed-pay': '기본급+수당 항목',
  gross: '지급 합계',
}

export function formatWon(amount: number): string {
  return `${Math.round(amount).toLocaleString('ko-KR')}원`
}

/** 해당 월에 적용되는 급여 설정: 적용 시작 월이 그 월 이하인 것 중 가장 최근. 없으면 가장 이른 설정 */
export function profileForMonth(profiles: readonly PayProfile[], month: string): PayProfile {
  const sorted = [...profiles].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
  return [...sorted].reverse().find((profile) => profile.effectiveFrom <= month) ?? sorted[0]
}

export interface PayLine {
  key: string
  label: string
  amount: number
  detail: string
}

function applyRounding(value: number, rounding: Settings['pay']['rounding']): number {
  return rounding === 'floor10' ? Math.floor(value / 10) * 10 : Math.round(value)
}

/** 공제 계산. 요율은 기준 금액 × 요율%. 다른 공제를 기준으로 하면 그 공제를 먼저 계산한다. */
export function computeDeductions(
  deductions: readonly Deduction[],
  bases: { 'base-salary': number; 'fixed-pay': number; gross: number },
  rounding: Settings['pay']['rounding'],
): PayLine[] {
  const byId = new Map(deductions.map((item) => [item.id, item]))
  const memo = new Map<string, number>()
  const evaluate = (item: Deduction, depth = 0): number => {
    const cached = memo.get(item.id)
    if (cached !== undefined) return cached
    if (depth > deductions.length) return 0 // 순환 방지 (스키마에서도 막음)
    let amount = item.value
    if (item.method === 'rate') {
      const base = item.base.startsWith('deduction:')
        ? (() => {
            const target = byId.get(item.base.slice('deduction:'.length))
            return target ? evaluate(target, depth + 1) : 0
          })()
        : bases[item.base as keyof typeof bases]
      amount = applyRounding((base * item.value) / 100, rounding)
    }
    memo.set(item.id, amount)
    return amount
  }
  return deductions.map((item) => {
    const amount = evaluate(item)
    const baseLabel = item.base.startsWith('deduction:')
      ? (byId.get(item.base.slice('deduction:'.length))?.name ?? '알 수 없음')
      : DEDUCTION_BASE_LABELS[item.base]
    return {
      key: item.id,
      label: item.name,
      amount,
      detail: item.method === 'rate' ? `${baseLabel} × ${item.value}%` : '직접 입력 금액',
    }
  })
}

export interface MonthlyPay {
  month: string
  profile: PayProfile
  payday: string
  earnings: PayLine[]
  deductions: PayLine[]
  gross: number
  totalDeductions: number
  net: number
  overtime: OvertimeSummary
  /** 급여와 별도 지급 — 실수령액에 포함하지 않음 */
  travel: MonthlyTravel
  record: PayrollRecord | null
  /** 실제 입금액 − 예상 실수령액 */
  difference: number | null
  notes: string[]
}

/**
 * 예전 기본 공제 항목의 소득세·지방소득세(직접 입력). 이제 간이세액표로 자동 계산하므로
 * 저장된 값은 지우지 않고 보존하되 계산·화면에서는 쓰지 않는다.
 */
export const LEGACY_TAX_DEDUCTION_IDS: readonly string[] = ['income-tax', 'local-tax']

export function estimateMonthlyPay(data: AppData, month: string, isHoliday: (date: string) => boolean): MonthlyPay {
  const { pay, overtime: rules } = data.settings
  const profile = profileForMonth(pay.profiles, month)
  const overtime = summarizeOvertime(data, month)
  const earnings: PayLine[] = [
    { key: 'base', label: '기본급', amount: profile.baseSalary, detail: `${profile.effectiveFrom}부터 적용 설정` },
    ...profile.items.map((item) => ({ key: `item-${item.id}`, label: item.name, amount: item.amount, detail: '매월 고정' })),
  ]
  const fixedPay = earnings.reduce((sum, line) => sum + line.amount, 0)

  const unrecognized = overtime.unrecognizedMinutes > 0 ? `, 미인정 ${formatMinutes(overtime.unrecognizedMinutes)}` : ''
  earnings.push({
    key: 'overtime',
    label: '연장근무 수당',
    amount: overtime.overtimeAmount,
    detail: `${overtime.period.start} ~ ${overtime.period.end} 입력 ${formatMinutes(overtime.overtimeMinutes)}${unrecognized} × 시간당 ${formatWon(rules.hourlyRate)}`,
  })
  if (overtime.holidayAllowance.count > 0) {
    earnings.push({
      key: 'holiday-allowance',
      label: '휴일근무 수당',
      amount: overtime.holidayAllowance.amount,
      detail: `${overtime.holidayAllowance.count}회 인정 ${formatMinutes(overtime.holidayAllowance.minutes)} × 시간당 ${formatWon(rules.hourlyRate)} (8시간 근무 수당 선택 ${formatMinutes(data.settings.holidayWork.allowanceMinutes)}, 8시간 미만 실근무)`,
    })
  }
  const gross = earnings.reduce((sum, line) => sum + line.amount, 0)
  // 월별 과세급여액 = 지급 합계 − 비과세 항목 (연장·휴일근무 수당은 과세)
  const taxFree = profile.items.filter((item) => item.taxFree).reduce((sum, item) => sum + item.amount, 0)
  const taxable = Math.max(0, gross - taxFree)
  const { familyCount, childCount } = data.settings.tax
  const taxes = calculateTaxes(taxable, familyCount, childCount)
  const deductions = [
    ...computeDeductions(profile.deductions, { 'base-salary': profile.baseSalary, 'fixed-pay': fixedPay, gross }, pay.rounding).filter(
      (line) => !LEGACY_TAX_DEDUCTION_IDS.includes(line.key),
    ),
    {
      key: 'auto-income-tax',
      label: '소득세',
      amount: taxes.incomeTax,
      detail: `간이세액표(${TAX_TABLE.effectiveFrom}) · 과세급여 ${formatWon(taxable)} · 공제대상가족 ${familyCount}명${childCount > 0 ? ` · 8~20세 자녀 ${childCount}명` : ''}`,
    },
    { key: 'auto-local-tax', label: '지방소득세', amount: taxes.localIncomeTax, detail: '소득세 × 10% (10원 미만 절사)' },
  ]
  const totalDeductions = deductions.reduce((sum, line) => sum + line.amount, 0)
  const net = gross - totalDeductions
  const record = data.payrollRecords[month] ?? null

  const notes = [
    `연장근무 수당은 산정 기간(${overtime.period.start} ~ ${overtime.period.end}) 실적입니다. 한도(월 산정 기간 ${formatMinutes(rules.capMinutes)}, 주 월~일 ${formatMinutes(rules.weeklyCapMinutes)}, 시간 단위 휴일근무 수당 포함)를 넘는 입력은 저장할 수 없고, 이전에 입력된 초과분은 미인정(0원)입니다.`,
    '출장비는 급여와 별도로 지급되어 예상 실수령액에 포함하지 않습니다.',
    `소득세는 국세청 근로소득 간이세액표(${TAX_TABLE.effectiveFrom} 시행)로 원천징수 비율 100% 기준 계산한 예상액입니다. 비과세로 표시한 지급 항목(${formatWon(taxFree)})은 과세급여에서 뺐습니다.`,
  ]
  const legacyTax = profile.deductions.filter((item) => LEGACY_TAX_DEDUCTION_IDS.includes(item.id) && item.value > 0)
  if (legacyTax.length > 0) notes.push(`직접 입력했던 ${legacyTax.map((item) => item.name).join('·')} 값은 사용하지 않고 자동 계산합니다. (저장된 값은 보존)`)
  const manualTax = profile.deductions.filter((item) => !LEGACY_TAX_DEDUCTION_IDS.includes(item.id) && /소득세/.test(item.name))
  if (manualTax.length > 0) notes.push(`공제 항목 '${manualTax.map((item) => item.name).join("', '")}'이 자동 계산 소득세와 중복될 수 있습니다. 필요 없으면 삭제하세요.`)
  if (profile.baseSalary === 0) notes.unshift('기본급이 0원입니다. 마이페이지에서 급여 설정을 입력하세요.')

  return {
    month,
    profile,
    payday: paydayDate(month, pay.payday, isHoliday),
    earnings,
    deductions,
    gross,
    totalDeductions,
    net,
    overtime,
    travel: monthlyTravel(data, month),
    record,
    difference: record?.actualDeposit != null ? record.actualDeposit - net : null,
    notes,
  }
}

export function setPayrollRecord(data: AppData, month: string, record: PayrollRecord): AppData {
  return { ...data, payrollRecords: { ...data.payrollRecords, [month]: record } }
}

/** 급여 초기화: 해당 월에 저장한 급여 기록(실제 입금액·메모)을 지운다 */
export function clearPayrollRecord(data: AppData, month: string): AppData {
  if (!(month in data.payrollRecords)) return data
  const payrollRecords = { ...data.payrollRecords }
  delete payrollRecords[month]
  return { ...data, payrollRecords }
}
