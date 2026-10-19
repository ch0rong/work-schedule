import { addMonths } from 'date-fns'
import { addDaysToDateString, parseDateString, toDateString } from '../../lib/date'
import type { AppData, LeaveEntry, Settings, WorkCategory, WorkEntry } from '../../lib/schema'
import { holidayWorkResult } from '../holidayWork/holidayWorkService'

export interface CompGrant {
  entryId: string
  date: string
  reason: string
  minutes: number
  /** 원칙상 사용 기한 (발생일 + 기한 개월). 지나도 사용은 막지 않는다 */
  lastUsableDate: string
  /** 사용자가 직접 삭제(소멸 처리)한 날. 이후 사용에는 차감하지 않는다 */
  dismissedOn: string | null
  usedMinutes: number
}

export interface CompUse {
  entry: LeaveEntry
  /** 차감된 발생 건 */
  allocations: { grantDate: string; minutes: number; overdue: boolean }[]
  /** 사용할 발생분이 없어 차감하지 못한 분 */
  unallocatedMinutes: number
}

/** active: 기한 안 · overdue: 기한 지남(사용 가능, 경고) · used: 모두 사용 · dismissed: 직접 삭제 */
export type CompGrantStatus = 'active' | 'overdue' | 'used' | 'dismissed'

export interface CompLeaveSummary {
  grants: (CompGrant & { remainingMinutes: number; status: CompGrantStatus })[]
  uses: CompUse[]
  earnedMinutes: number
  usedMinutes: number
  /** 기한이 지났지만 남아 있는 분 (사용 가능) */
  overdueMinutes: number
  /** 직접 삭제한 발생 건의 남은 분 */
  dismissedMinutes: number
  /** 기준일 현재 사용 가능한 잔여 (기한 지난 분 포함) */
  availableMinutes: number
  /** 기준일부터 7일 안에 기한이 되는 잔여 */
  expiringSoonMinutes: number
  /** 기준일 이후에 발생할 예정인 대체휴무 (아직 사용 가능 잔여에 넣지 않는다) */
  upcoming: { date: string; minutes: number }[]
}

export const COMP_STATUS_LABELS: Record<CompGrantStatus, string> = { active: '사용 가능', overdue: '기한 지남', used: '사용 완료', dismissed: '삭제함' }

const REASONS = { 'weekend-duty': '주말 당직', 'comp-leave': '휴일근무', 'trip-comp': '휴일 출장' } as const

/** 대체휴무가 발생하는 근무: 주말 당직(항상), 휴일근무(8시간 이상 + 대체휴무·출장 선택) */
export function earnsCompLeave(entry: WorkEntry, category: WorkCategory | undefined, settings: Settings): boolean {
  if (category === 'weekend-duty') return true
  return category === 'holiday-work' && holidayWorkResult(entry, settings).earnsCompLeave
}

/** 대체휴무 발생량: 1회당 항상 1일. 쓸 때는 반일·시간 단위로 나눠 쓴다. 발생하지 않으면 0 */
export function compLeaveMinutesFor(entry: WorkEntry, category: WorkCategory | undefined, settings: Settings): number {
  return earnsCompLeave(entry, category, settings) ? settings.leave.minutesPerDay : 0
}

/** 원칙상 사용 기한 = 발생일 + 기한 개월 (월말은 그 달 마지막 날) */
export function compExpiryDate(date: string, settings: Settings): string {
  return toDateString(addMonths(parseDateString(date)!, settings.compLeave.validityMonths))
}

/**
 * 저장할 근무의 대체휴무 기한. 발생하지 않으면 null.
 * 날짜가 그대로면 이미 기록된 기한을 유지한다(기한 설정을 바꿔도 지난 발생 건은 그대로).
 */
export function compExpiryForEntry(entry: WorkEntry, data: AppData, previous?: WorkEntry): string | null {
  const category = data.workTypes.find((type) => type.id === entry.workTypeId)?.category
  if (compLeaveMinutesFor(entry, category, data.settings) <= 0) return null
  if (previous?.date === entry.date && previous.compExpiresOn) return previous.compExpiresOn
  return compExpiryDate(entry.date, data.settings)
}

export function compGrants(data: AppData): CompGrant[] {
  const typeById = new Map(data.workTypes.map((type) => [type.id, type]))
  const dismissedOn = new Map(data.compDismissals.map((item) => [item.entryId, item.date]))
  return data.entries
    .filter((entry): entry is WorkEntry => entry.kind === 'work')
    .flatMap((entry) => {
      const category = typeById.get(entry.workTypeId)?.category
      const minutes = compLeaveMinutesFor(entry, category, data.settings)
      if (minutes <= 0) return []
      const reasonKey = category === 'weekend-duty' ? 'weekend-duty' : entry.holidayCompensation === 'trip-comp' ? 'trip-comp' : 'comp-leave'
      return [{
        entryId: entry.id,
        date: entry.date,
        reason: REASONS[reasonKey],
        minutes,
        lastUsableDate: entry.compExpiresOn ?? compExpiryDate(entry.date, data.settings),
        dismissedOn: dismissedOn.get(entry.id) ?? null,
        usedMinutes: 0,
      }]
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * 사용(대체휴무)을 날짜순으로, 그 시점에 쓸 수 있는 발생분 중 기한이 빠른 것부터 차감한다(기한 지난 분은 마지막).
 * 기한이 지난 발생분도 쓸 수 있다(협의 사용). 자동 소멸은 없고, 직접 삭제한 발생 건만 그날 이후 차감하지 않는다.
 */
export function summarizeCompLeave(data: AppData, today: string): CompLeaveSummary {
  const grants = compGrants(data)
  const usable = (grant: CompGrant, date: string) => grant.date <= date && (grant.dismissedOn === null || date <= grant.dismissedOn)
  const take = (grant: CompGrant, left: number, date: string, allocations: CompUse['allocations']) => {
    const amount = Math.min(left, grant.minutes - grant.usedMinutes)
    if (amount <= 0) return left
    grant.usedMinutes += amount
    allocations.push({ grantDate: grant.date, minutes: amount, overdue: grant.lastUsableDate < date })
    return left - amount
  }
  const entries = data.entries
    .filter((entry): entry is LeaveEntry => entry.kind === 'leave' && entry.leaveType === 'comp')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // 1) 발생 건을 직접 고른 사용부터 그 건에서 차감, 2) 나머지는 사용일순으로 기한이 빠른 발생분부터
  const result = new Map<string, CompUse>()
  for (const entry of entries.filter((item) => item.compSourceId !== null)) {
    const allocations: CompUse['allocations'] = []
    const grant = grants.find((item) => item.entryId === entry.compSourceId)
    const left = grant && usable(grant, entry.date) ? take(grant, entry.minutes, entry.date, allocations) : entry.minutes
    result.set(entry.id, { entry, allocations, unallocatedMinutes: left })
  }
  for (const entry of entries.filter((item) => item.compSourceId === null)) {
    const allocations: CompUse['allocations'] = []
    let left = entry.minutes
    // 기한 안의 발생분을 기한이 빠른 순으로 먼저, 기한이 지난 발생분은 마지막에 쓴다
    const overdue = (grant: CompGrant) => grant.lastUsableDate < entry.date
    const available = grants
      .filter((grant) => usable(grant, entry.date))
      .sort((a, b) => (overdue(a) !== overdue(b) ? (overdue(a) ? 1 : -1) : a.lastUsableDate < b.lastUsableDate ? -1 : 1))
    for (const grant of available) {
      if (left <= 0) break
      left = take(grant, left, entry.date, allocations)
    }
    result.set(entry.id, { entry, allocations, unallocatedMinutes: left })
  }
  const uses = entries.map((entry) => result.get(entry.id)!)

  const soon = addDaysToDateString(today, 7)
  const detailed = grants.map((grant) => {
    const remainingMinutes = grant.minutes - grant.usedMinutes
    const status: CompGrantStatus =
      remainingMinutes === 0 ? 'used' : grant.dismissedOn !== null ? 'dismissed' : grant.lastUsableDate < today ? 'overdue' : 'active'
    return { ...grant, remainingMinutes, status }
  })
  const total = (status: CompGrantStatus) => detailed.filter((grant) => grant.status === status).reduce((sum, grant) => sum + grant.remainingMinutes, 0)
  const available = detailed.filter((grant) => (grant.status === 'active' || grant.status === 'overdue') && grant.date <= today)
  return {
    grants: detailed,
    uses,
    earnedMinutes: grants.reduce((sum, grant) => sum + grant.minutes, 0),
    usedMinutes: grants.reduce((sum, grant) => sum + grant.usedMinutes, 0),
    overdueMinutes: total('overdue'),
    dismissedMinutes: total('dismissed'),
    availableMinutes: available.reduce((sum, grant) => sum + grant.remainingMinutes, 0),
    expiringSoonMinutes: available.filter((grant) => grant.status === 'active' && grant.lastUsableDate <= soon).reduce((sum, grant) => sum + grant.remainingMinutes, 0),
    upcoming: detailed
      .filter((grant) => grant.date > today && grant.status !== 'dismissed' && grant.remainingMinutes > 0)
      .map((grant) => ({ date: grant.date, minutes: grant.remainingMinutes })),
  }
}

/** 대체휴무 사용을 저장하기 전 경고 (기한이 지나도 저장은 막지 않는다) */
export function getCompUseWarnings(data: AppData, entry: LeaveEntry): string[] {
  if (entry.leaveType !== 'comp') return []
  const next = { ...data, entries: [...data.entries.filter((item) => item.id !== entry.id), entry] }
  const use = summarizeCompLeave(next, entry.date).uses.find((item) => item.entry.id === entry.id)
  if (!use) return []
  const warnings: string[] = []
  const overdue = use.allocations.filter((item) => item.overdue)
  if (overdue.length > 0) {
    warnings.push(`사용 기한이 지난 대체휴무(${overdue.map((item) => `${item.grantDate} 발생분`).join(', ')})를 사용합니다. 협의된 경우에만 저장하세요.`)
  }
  if (use.unallocatedMinutes > 0) warnings.push('사용일 기준으로 사용할 수 있는 대체휴무가 부족합니다. (발생일 이후의 발생분만 사용할 수 있습니다)')
  return warnings
}

/** 대체휴무 발생 건을 직접 삭제(소멸 처리)한다. 발생 일정은 지우지 않는다 */
export function dismissCompGrant(data: AppData, entryId: string, date: string): AppData {
  if (data.compDismissals.some((item) => item.entryId === entryId)) return data
  return { ...data, compDismissals: [...data.compDismissals, { entryId, date }] }
}
