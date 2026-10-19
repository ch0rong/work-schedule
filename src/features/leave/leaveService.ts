import { addYears, differenceInCalendarMonths, differenceInCalendarYears } from 'date-fns'
import { eachDateString, isWeekendDate, parseDateString, toDateString } from '../../lib/date'
import type { AppData, LeaveEntry, LeaveType, Settings } from '../../lib/schema'
import { SINGLE_DAY_LEAVE_TYPES } from '../../lib/schema'

export const LEAVE_LABELS: Record<LeaveType, string> = {
  annual: '연차',
  'half-am': '반차(오전)',
  'half-pm': '반차(오후)',
  outing: '외출',
  'early-leave': '조퇴',
  official: '공가',
  sick: '병가',
  special: '특별휴가',
  comp: '대체휴무',
}

/** DESIGN.md: 연차 초록, 반차·외출 연두, 공가·특별 하늘, 병가 분홍, 대체휴무 보라 */
export const LEAVE_COLORS: Record<LeaveType, string> = {
  annual: '#2F9E5B',
  'half-am': '#5DB97F',
  'half-pm': '#5DB97F',
  outing: '#7FB04A',
  'early-leave': '#7FB04A',
  official: '#3B8FD1',
  sick: '#D6578A',
  special: '#2E9FC2',
  comp: '#7E57C2',
}

export function isHalfDay(type: LeaveType): boolean {
  return type === 'half-am' || type === 'half-pm'
}

export function isSingleDayType(type: LeaveType): boolean {
  return SINGLE_DAY_LEAVE_TYPES.includes(type)
}

/** 시간 단위로 입력하는 유형 */
export function isHourlyType(type: LeaveType): boolean {
  return type === 'outing' || type === 'early-leave'
}

/** 연차에서 차감하는지 (적용 규정·설정에 따름) */
export function deductsAnnualLeave(type: LeaveType, settings: Settings): boolean {
  switch (type) {
    case 'annual':
    case 'half-am':
    case 'half-pm':
      return true
    case 'outing':
    case 'early-leave':
      // 누계 시간이 연차 1일분이 되면 1일로 계산 (마이페이지 설정, 기본: 차감)
      return settings.leave.outingDeducts
    case 'official':
      return settings.leave.officialDeducts
    case 'sick':
      return settings.leave.sickDeducts
    case 'special':
    case 'comp':
      return false
  }
}

/** 기간 중 주말·휴일을 뺀 날짜 수 */
export function countWorkingDays(start: string, end: string, isHoliday: (date: string) => boolean): number {
  return eachDateString(start, end).filter((date) => !isWeekendDate(date) && !isHoliday(date)).length
}

/** 유형별 기본 사용량(분) */
export function defaultLeaveMinutes(
  type: LeaveType,
  start: string,
  end: string,
  minutesPerDay: number,
  isHoliday: (date: string) => boolean,
): number {
  if (isHalfDay(type)) return minutesPerDay / 2
  if (isHourlyType(type)) return 60
  return Math.max(1, countWorkingDays(start, end, isHoliday)) * minutesPerDay
}

/** 분을 `2일 4시간 30분` 형식으로 표시 (1일 = minutesPerDay) */
export function formatLeaveAmount(totalMinutes: number, minutesPerDay: number): string {
  const sign = totalMinutes < 0 ? '-' : ''
  let rest = Math.abs(Math.round(totalMinutes))
  const days = Math.floor(rest / minutesPerDay)
  rest -= days * minutesPerDay
  const hours = Math.floor(rest / 60)
  const minutes = rest % 60
  const parts = [days ? `${days}일` : '', hours ? `${hours}시간` : '', minutes ? `${minutes}분` : ''].filter(Boolean)
  return parts.length ? sign + parts.join(' ') : '0일'
}

// ---------- 연차 부여 ----------

export interface LeavePeriod {
  /** grants의 key: 회계연도 YYYY, 입사일 기준은 기간 시작일 */
  key: string
  start: string
  end: string
}

/** 날짜가 속한 연차 부여 기간. 입사일 기준인데 입사일이 없거나 입사 전이면 null */
export function leavePeriodFor(date: string, settings: Settings): LeavePeriod | null {
  if (settings.leave.basis === 'fiscal-year') {
    const year = date.slice(0, 4)
    return { key: year, start: `${year}-01-01`, end: `${year}-12-31` }
  }
  const hire = settings.leave.hireDate ? parseDateString(settings.leave.hireDate) : null
  const target = parseDateString(date)
  if (!hire || !target || target < hire) return null
  const years = differenceInCalendarYears(target, hire)
  let start = addYears(hire, years)
  if (start > target) start = addYears(hire, years - 1)
  const next = addYears(start, 1)
  const start2 = toDateString(start)
  return { key: start2, start: start2, end: toDateString(new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1)) }
}

export interface GrantReference {
  days: number | null
  /** 계산 근거 설명 */
  explanation: string
}

/** 적용 규정에 따른 자동 부여 참고값. 회사가 실제 부여한 값(grants)이 우선한다. */
export function referenceGrant(period: LeavePeriod, settings: Settings): GrantReference {
  const hire = settings.leave.hireDate ? parseDateString(settings.leave.hireDate) : null
  if (!hire) return { days: null, explanation: '입사일을 입력하면 참고값을 계산합니다.' }
  const periodStart = parseDateString(period.start)!
  const periodEnd = parseDateString(period.end)!
  if (hire > periodEnd) return { days: 0, explanation: '이 기간에는 아직 입사 전입니다.' }

  // 기간 시작일 기준 재직 개월 수 (기간 중 입사면 0)
  const months = hire >= periodStart ? 0 : differenceInCalendarMonths(periodStart, hire) - (periodStart.getDate() < hire.getDate() ? 1 : 0)

  if (settings.regulation === 'public-servant') {
    const table = [...settings.leave.publicServantTable].sort((a, b) => a.minMonths - b.minMonths)
    // 재직 1개월 미만(신규 임용 기간)은 첫 구간을 적용
    const row = [...table].reverse().find((item) => months >= item.minMonths) ?? table[0]
    return {
      days: row.days,
      explanation: `공무원 복무규정 연가일수표: 기간 시작일 기준 재직 ${Math.floor(months / 12)}년 ${months % 12}개월 → ${row.days}일`,
    }
  }

  const years = Math.floor(months / 12)
  if (years < 1) {
    // 1년 미만: 1개월 개근 시 1일 (최대 11일) — 기간 동안 채울 수 있는 개월 수 기준
    const from = hire > periodStart ? hire : periodStart
    const accrual = Math.min(11, Math.max(0, differenceInCalendarMonths(periodEnd, from)))
    return { days: accrual, explanation: `근로기준법: 1년 미만 매월 1일 발생 (이 기간 최대 ${accrual}일, 최대 11일)` }
  }
  const days = Math.min(25, 15 + Math.floor((years - 1) / 2))
  return { days, explanation: `근로기준법: 계속근로 ${years}년 → 15일 + 2년마다 1일 가산 = ${days}일 (최대 25일)` }
}

export interface AnnualLeaveSummary {
  period: LeavePeriod
  reference: GrantReference
  /** 직접 입력한 부여 일수 (없으면 null) */
  manualDays: number | null
  extraDays: number
  grantedMinutes: number
  usedMinutes: number
  remainingMinutes: number
  /** 기간 안의 모든 휴가·근태 (차감되지 않는 것 포함) */
  entries: LeaveEntry[]
}

/** 연차 잔여 = 부여(직접 입력 또는 참고값 + 추가 부여) − 차감 대상 사용 분 */
export function summarizeAnnualLeave(data: AppData, period: LeavePeriod): AnnualLeaveSummary {
  const settings = data.settings
  const grant = settings.leave.grants[period.key]
  const reference = referenceGrant(period, settings)
  const manualDays = grant?.days ?? null
  const extraDays = grant?.extraDays ?? 0
  const grantedDays = (manualDays ?? reference.days ?? 0) + extraDays
  const entries = data.entries
    .filter((entry): entry is LeaveEntry => entry.kind === 'leave' && entry.date >= period.start && entry.date <= period.end)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const usedMinutes = entries
    .filter((entry) => deductsAnnualLeave(entry.leaveType, settings))
    .reduce((sum, entry) => sum + entry.minutes, 0)
  const grantedMinutes = Math.round(grantedDays * settings.leave.minutesPerDay)
  return {
    period,
    reference,
    manualDays,
    extraDays,
    grantedMinutes,
    usedMinutes,
    remainingMinutes: grantedMinutes - usedMinutes,
    entries,
  }
}

/** 저장하면 잔여 연차가 음수가 되는지 경고 */
export function getLeaveWarnings(data: AppData, entry: LeaveEntry): string[] {
  if (!deductsAnnualLeave(entry.leaveType, data.settings)) return []
  const period = leavePeriodFor(entry.date, data.settings)
  if (!period) return ['입사일 기준 연차를 쓰려면 마이페이지에서 입사일을 입력하세요.']
  const others = { ...data, entries: data.entries.filter((item) => item.id !== entry.id) }
  const summary = summarizeAnnualLeave(others, period)
  const remaining = summary.remainingMinutes - entry.minutes
  return remaining < 0
    ? [`저장하면 잔여 연차가 ${formatLeaveAmount(remaining, data.settings.leave.minutesPerDay)}이 됩니다.`]
    : []
}

/** 부분 사용(반차·외출 등)인지: 같은 날 근무와 함께 있는 것이 정상이다 */
export function isPartialLeave(entry: LeaveEntry, minutesPerDay: number): boolean {
  return entry.startTime !== null || entry.minutes < minutesPerDay || isSingleDayType(entry.leaveType)
}
