import { isWeekendDate, timeToMinutes } from '../../lib/date'
import type { AppData, Entry, LeaveEntry, Settings, WorkCategory, WorkEntry, WorkType } from '../../lib/schema'
import { calculateNetMinutes, formatMinutes, MINUTES_PER_DAY, workInterval } from '../../lib/time'
import { HOLIDAY_WORK_FULL_DAY_MINUTES, holidayWorkResult } from '../holidayWork/holidayWorkService'
import { compExpiryForEntry, compGrants } from '../leave/compLeaveService'
import { formatLeaveAmount, isPartialLeave, LEAVE_LABELS } from '../leave/leaveService'
import { overtimeMinutes } from '../overtime/overtimeService'
import { formatWon } from '../pay/payService'
import { isMultiDayTrip, TRIP_LABELS, tripMinutes, tripNights } from '../travel/travelService'

/** 실근무시간이 이 값을 넘으면 확인을 받는다. */
export const LONG_SHIFT_MINUTES = 12 * 60

export const CATEGORY_LABELS: Record<WorkCategory, string> = {
  regular: '기본근무',
  flex: '유연근무',
  'weekday-duty': '평일 당직',
  'weekend-duty': '주말 당직',
  'holiday-work': '휴일근무',
  off: '휴무',
  custom: '사용자 정의',
}

export function createId(): string {
  return crypto.randomUUID()
}

// ---------- 기본 시간 ----------

export interface ShiftTimes {
  startTime: string
  endTime: string
  endsNextDay: boolean
  breakMinutes: number
}

function toTime(total: number): string {
  const inDay = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`
}

/** 유연근무 종료 = 시작 + 실근무 + 휴게 */
export function flexShift(startTime: string, settings: Settings): ShiftTimes {
  const { netMinutes, breakMinutes } = settings.schedule.flex
  const end = timeToMinutes(startTime) + netMinutes + breakMinutes
  return { startTime, endTime: toTime(end), endsNextDay: end >= MINUTES_PER_DAY, breakMinutes }
}

/** 휴일근무 기본: 종료 = 시작 + 8시간 + 사용자가 입력한 휴게 (휴게를 임의로 정하지 않는다) */
export function holidayWorkShift(startTime: string, breakMinutes: number): ShiftTimes {
  const end = timeToMinutes(startTime) + HOLIDAY_WORK_FULL_DAY_MINUTES + breakMinutes
  return { startTime, endTime: toTime(end), endsNextDay: end >= MINUTES_PER_DAY, breakMinutes }
}

/** 근무 유형 분류에 따른 기본 시간. 사용자 정의 유형은 기본근무 시간, 휴일근무는 시작 + 8시간(휴게 0)을 제안한다. */
export function defaultShift(category: WorkCategory, settings: Settings, flexStart?: string): ShiftTimes {
  const { regular, weekdayDuty, weekendDuty } = settings.schedule
  const fromShift = (shift: typeof regular): ShiftTimes => ({
    startTime: shift.start,
    endTime: shift.end,
    endsNextDay: shift.end <= shift.start,
    breakMinutes: shift.breakMinutes,
  })
  switch (category) {
    case 'flex':
      return flexShift(flexStart ?? regular.start, settings)
    case 'weekday-duty':
      return fromShift(weekdayDuty)
    case 'weekend-duty':
      return fromShift(weekendDuty)
    case 'holiday-work':
      // 휴게시간을 임의로 빼지 않는다: 휴게 0으로 시작하고 사용자가 직접 입력
      return holidayWorkShift(regular.start, 0)
    default:
      return fromShift(regular)
  }
}

/** 날짜에 맞는 당직 유형 제안: 주말·휴일이면 주말 당직 */
export function isWeekendOrHoliday(date: string, isHoliday: (date: string) => boolean): boolean {
  return isWeekendDate(date) || isHoliday(date)
}

// ---------- 일정 ----------

/**
 * 대체휴무 발생 건이 없어지면(삭제·유형 변경) 그 건을 가리키던 사용은 자동 차감으로 되돌리고,
 * 그 건의 직접 삭제 기록도 지운다.
 */
function releaseMissingCompSources(data: AppData): AppData {
  const grantIds = new Set(compGrants(data).map((grant) => grant.entryId))
  const staleSource = data.entries.some((entry) => entry.kind === 'leave' && entry.compSourceId !== null && !grantIds.has(entry.compSourceId))
  const staleDismissal = data.compDismissals.some((item) => !grantIds.has(item.entryId))
  if (!staleSource && !staleDismissal) return data
  return {
    ...data,
    entries: data.entries.map((entry) =>
      entry.kind === 'leave' && entry.compSourceId !== null && !grantIds.has(entry.compSourceId) ? { ...entry, compSourceId: null } : entry,
    ),
    compDismissals: data.compDismissals.filter((item) => grantIds.has(item.entryId)),
  }
}

export function upsertEntry(data: AppData, input: Entry): AppData {
  const previous = data.entries.find((item) => item.id === input.id)
  const exists = previous !== undefined
  // 대체휴무가 발생하는 근무는 원칙상 사용 기한을 기록한다
  const entry: Entry =
    input.kind === 'work' ? { ...input, compExpiresOn: compExpiryForEntry(input, data, previous?.kind === 'work' ? previous : undefined) } : input
  return releaseMissingCompSources({
    ...data,
    entries: exists ? data.entries.map((item) => (item.id === entry.id ? entry : item)) : [...data.entries, entry],
  })
}

export function removeEntry(data: AppData, id: string): AppData {
  return releaseMissingCompSources({ ...data, entries: data.entries.filter((entry) => entry.id !== id) })
}

const KIND_ORDER: Record<Entry['kind'], number> = { leave: 0, work: 1, trip: 2 }

/** 날짜순, 같은 날은 휴가 → 근무 → 출장, 그 안에서 시작 시각순 */
export function compareEntries(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  const aKey = a.startTime ?? ''
  const bKey = b.startTime ?? ''
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

/** 해당 날짜에 걸쳐 있는 일정 (자정 넘김 근무는 다음 날에도 포함) */
export function entriesOnDate(entries: readonly Entry[], date: string): Entry[] {
  return entries.filter((entry) => entry.date <= date && entry.endDate >= date).sort(compareEntries)
}

export function entryTitle(entry: Entry, data: Pick<AppData, 'workTypes' | 'settings'>): string {
  if (entry.kind === 'trip') return `출장(${TRIP_LABELS[entry.tripType]})`
  if (entry.kind === 'leave') {
    if (entry.leaveType === 'special') {
      const name = data.settings.specialLeaveTypes.find((type) => type.id === entry.specialTypeId)?.name
      return name ? `특별휴가(${name})` : LEAVE_LABELS.special
    }
    return LEAVE_LABELS[entry.leaveType]
  }
  return data.workTypes.find((type) => type.id === entry.workTypeId)?.name ?? '알 수 없는 유형'
}

export function describeEntryTime(entry: Entry, settings: Settings): string {
  if (entry.kind === 'trip') {
    return isMultiDayTrip(entry)
      ? `${entry.date} ${entry.startTime} ~ ${entry.endDate} ${entry.endTime} · ${tripNights(entry)}박 ${tripNights(entry) + 1}일`
      : `${entry.startTime} ~ ${entry.endTime} · ${formatMinutes(tripMinutes(entry))}`
  }
  if (entry.kind === 'leave') {
    const range = entry.date === entry.endDate ? entry.date : `${entry.date} ~ ${entry.endDate}`
    const time = entry.startTime ? ` ${entry.startTime}~${entry.endTime}` : ''
    return `${range}${time} · ${formatLeaveAmount(entry.minutes, settings.leave.minutesPerDay)}`
  }
  const end = entry.endsNextDay ? `다음 날 ${entry.endTime}` : entry.endTime
  const overtime = overtimeMinutes(entry)
  const overtimeText = overtime > 0 ? ` · 연장 ${formatMinutes(overtime)}` : ''
  return `${entry.startTime} ~ ${end} · 휴게 ${entry.breakMinutes}분 · 실근무 ${formatMinutes(calculateNetMinutes(entry))}${overtimeText}`
}

export interface HolidayWorkCompensationText {
  /** 달력 라벨용: `수당 72,200원`, `대체휴무 1일`, `출장 · 대체휴무 1일` */
  short: string
  /** 날짜 패널용 산정 내역 */
  detail: string
}

/** 휴일근무 일정의 보상(수당 금액 또는 대체휴무). 휴일근무가 아니면 null */
export function holidayWorkCompensationText(entry: Entry, data: Pick<AppData, 'workTypes' | 'settings'>): HolidayWorkCompensationText | null {
  if (entry.kind !== 'work' || data.workTypes.find((type) => type.id === entry.workTypeId)?.category !== 'holiday-work') return null
  const result = holidayWorkResult(entry, data.settings)
  const dropped = result.droppedMinutes > 0 ? ` · 8시간 초과 ${formatMinutes(result.droppedMinutes)} 미인정` : ''
  if (result.compensation === 'allowance') {
    const basis = result.fullDay ? '8시간 근무 수당 기준' : '8시간 미만 실근무'
    return {
      short: `수당 ${formatWon(result.amount)}`,
      detail: `${formatMinutes(result.allowanceMinutes)} × ${formatWon(data.settings.overtime.hourlyRate)} · ${basis}${dropped}`,
    }
  }
  const short = result.compensation === 'trip-comp' ? '출장 · 대체휴무 1일' : '대체휴무 1일'
  return { short, detail: `수당 없음${dropped}` }
}

/** 같은 날 반차·외출 등을 뺀 실제 근무시간(분) */
export function netWorkMinutesOnDate(data: AppData, date: string): { work: number; leave: number; net: number } {
  const typeById = new Map(data.workTypes.map((type) => [type.id, type]))
  const work = data.entries
    .filter((entry): entry is WorkEntry => entry.kind === 'work' && entry.date === date && (typeById.get(entry.workTypeId)?.countsAsWork ?? false))
    .reduce((sum, entry) => sum + calculateNetMinutes(entry) + overtimeMinutes(entry), 0)
  const leave = data.entries
    .filter(
      (entry): entry is LeaveEntry =>
        entry.kind === 'leave' && entry.date === date && entry.endDate === date && isPartialLeave(entry, data.settings.leave.minutesPerDay),
    )
    .reduce((sum, entry) => sum + entry.minutes, 0)
  return { work, leave, net: Math.max(0, work - leave) }
}

// ---------- 경고 ----------

/** 같은 시간대에 겹치는 다른 근무 */
export function findTimeOverlaps(entries: readonly Entry[], candidate: WorkEntry): WorkEntry[] {
  const [start, end] = workInterval(candidate)
  return entries.filter((entry): entry is WorkEntry => {
    if (entry.kind !== 'work' || entry.id === candidate.id) return false
    const [otherStart, otherEnd] = workInterval(entry)
    return start < otherEnd && otherStart < end
  })
}

/** 하루 전체 휴가와 근무가 겹치는 일정 (반차·외출 등 부분 사용은 제외) */
export function findLeaveWorkConflicts(data: AppData, candidate: Entry): Entry[] {
  if (candidate.kind === 'trip') return []
  const minutesPerDay = data.settings.leave.minutesPerDay
  const fullDay = (entry: Entry) => entry.kind === 'leave' && !isPartialLeave(entry, minutesPerDay)
  if (candidate.kind === 'leave' && !fullDay(candidate)) return []
  return data.entries.filter((entry) => {
    if (entry.id === candidate.id) return false
    if (candidate.kind === 'work') return fullDay(entry) && candidate.date >= entry.date && candidate.date <= entry.endDate
    return entry.kind === 'work' && entry.date >= candidate.date && entry.date <= candidate.endDate
  })
}

export function getEntryWarnings(data: AppData, candidate: Entry): string[] {
  const warnings: string[] = []
  const describe = (entry: Entry) => `${entry.date} ${entryTitle(entry, data)}`

  if (candidate.kind === 'work') {
    for (const entry of findTimeOverlaps(data.entries, candidate)) {
      warnings.push(`시간이 겹치는 근무가 있습니다: ${describe(entry)} ${entry.startTime}~${entry.endTime}`)
    }
    const net = calculateNetMinutes(candidate) + overtimeMinutes(candidate)
    if (net > LONG_SHIFT_MINUTES) warnings.push(`연장 포함 근무시간이 ${formatMinutes(net)}으로 매우 깁니다. 시간을 다시 확인하세요.`)
  }
  for (const entry of findLeaveWorkConflicts(data, candidate)) {
    warnings.push(candidate.kind === 'work' ? `같은 날 휴가가 있습니다: ${describe(entry)}` : `휴가 기간에 근무 일정이 있습니다: ${describe(entry)}`)
  }
  return warnings
}

// ---------- 근무 유형 ----------

export function isWorkTypeInUse(data: AppData, typeId: string): boolean {
  return data.entries.some((entry) => entry.kind === 'work' && entry.workTypeId === typeId)
}

export function upsertWorkType(data: AppData, type: WorkType): AppData {
  const exists = data.workTypes.some((item) => item.id === type.id)
  return {
    ...data,
    workTypes: exists ? data.workTypes.map((item) => (item.id === type.id ? type : item)) : [...data.workTypes, type],
  }
}

/** 참조 중인 유형은 삭제할 수 없다. 대신 archived로 숨긴다. */
export function removeWorkType(data: AppData, typeId: string): AppData {
  if (isWorkTypeInUse(data, typeId)) throw new Error('사용 중인 근무 유형은 삭제할 수 없습니다.')
  return { ...data, workTypes: data.workTypes.filter((type) => type.id !== typeId) }
}

/** 배경색 위에 읽기 좋은 글자색 */
export function readableTextColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.4 ? '#1f2328' : '#ffffff'
}
