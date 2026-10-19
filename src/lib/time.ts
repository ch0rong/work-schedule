import { endOfMonth, startOfWeek } from 'date-fns'
import { addDaysToDateString, parseDateString, timeToMinutes, toDateString } from './date'
import type { Entry, WorkEntry, WorkType } from './schema'

export const MINUTES_PER_DAY = 24 * 60

export interface TimeRangeInput {
  startTime: string
  endTime: string
  endsNextDay: boolean
}

/**
 * 경과시간(분) = 종료 시각 - 시작 시각.
 * 다음 날 종료면 종료 시각에 24시간을 더한다. 결과가 0 이하이면 잘못된 입력이다.
 */
export function calculateElapsedMinutes({ startTime, endTime, endsNextDay }: TimeRangeInput): number {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime) + (endsNextDay ? MINUTES_PER_DAY : 0)
  return end - start
}

/** 실근무시간(분) = 경과시간 - 휴게시간 */
export function calculateNetMinutes(input: TimeRangeInput & { breakMinutes: number }): number {
  return calculateElapsedMinutes(input) - input.breakMinutes
}

/** 분을 `8시간 30분` 형식으로 표시한다. */
export function formatMinutes(total: number): string {
  const sign = total < 0 ? '-' : ''
  const abs = Math.abs(Math.round(total))
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  if (hours === 0) return `${sign}${minutes}분`
  if (minutes === 0) return `${sign}${hours}시간`
  return `${sign}${hours}시간 ${minutes}분`
}

// ---------- 기간 ----------

/** 시작일·종료일을 모두 포함하는 기간 (`YYYY-MM-DD`) */
export interface DateRange {
  start: string
  end: string
}

export function monthRange(yearMonth: string): DateRange {
  const first = parseDateString(`${yearMonth}-01`)
  if (!first) throw new Error(`잘못된 월 형식: ${yearMonth}`)
  return { start: toDateString(first), end: toDateString(endOfMonth(first)) }
}

export function weekRange(date: string, weekStartsOn: number): DateRange {
  const parsed = parseDateString(date)
  if (!parsed) throw new Error(`잘못된 날짜 형식: ${date}`)
  const start = toDateString(startOfWeek(parsed, { weekStartsOn: weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6 }))
  return { start, end: addDaysToDateString(start, 6) }
}

export function isDateInRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end
}

// ---------- 합계 ----------

export interface WorkSummary {
  /** 실근무 합계 (휴게 제외) */
  netMinutes: number
  elapsedMinutes: number
  breakMinutes: number
  entryCount: number
  workDays: number
  byType: { workTypeId: string; name: string; netMinutes: number; entryCount: number }[]
}

/**
 * 기간의 예정 근무시간 합계.
 * 자정을 넘기는 근무는 시작일에 전부 포함한다. 근무시간에 포함하지 않는 유형(휴무 등)은 제외한다.
 */
export function summarizeWork(entries: readonly Entry[], workTypes: readonly WorkType[], range: DateRange): WorkSummary {
  const typeById = new Map(workTypes.map((type) => [type.id, type]))
  const byType = new Map<string, WorkSummary['byType'][number]>()
  const days = new Set<string>()
  const summary: WorkSummary = { netMinutes: 0, elapsedMinutes: 0, breakMinutes: 0, entryCount: 0, workDays: 0, byType: [] }

  for (const entry of entries) {
    if (entry.kind !== 'work' || !isDateInRange(entry.date, range)) continue
    const type = typeById.get(entry.workTypeId)
    if (!type?.countsAsWork) continue

    const elapsed = calculateElapsedMinutes(entry)
    const net = elapsed - entry.breakMinutes
    summary.netMinutes += net
    summary.elapsedMinutes += elapsed
    summary.breakMinutes += entry.breakMinutes
    summary.entryCount += 1
    days.add(entry.date)

    const row = byType.get(type.id) ?? { workTypeId: type.id, name: type.name, netMinutes: 0, entryCount: 0 }
    row.netMinutes += net
    row.entryCount += 1
    byType.set(type.id, row)
  }

  summary.workDays = days.size
  summary.byType = [...byType.values()]
  return summary
}

// ---------- 절대 시각 구간 ----------

/** 1970-01-01부터의 일 수. 시간대·서머타임 영향을 받지 않도록 UTC로 계산한다. */
export function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/** 근무를 [시작, 종료) 절대 분 구간으로 바꾼다. */
export function workInterval(entry: WorkEntry): [number, number] {
  const start = dayNumber(entry.date) * MINUTES_PER_DAY + timeToMinutes(entry.startTime)
  return [start, start + calculateElapsedMinutes(entry)]
}

function overlapLength(a: [number, number], b: [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))
}

/**
 * 근무 구간 중 매일 반복되는 시간대(예: 22:00~06:00)와 겹치는 분.
 * 시작과 종료가 같으면 하루 전체로 본다. 휴게시간 위치는 알 수 없으므로 빼지 않는다.
 */
export function minutesWithinDailyRange(entry: WorkEntry, range: { start: string; end: string }): number {
  const [start, end] = workInterval(entry)
  const rangeStart = timeToMinutes(range.start)
  let rangeEnd = timeToMinutes(range.end)
  if (rangeEnd <= rangeStart) rangeEnd += MINUTES_PER_DAY

  const firstDay = dayNumber(entry.date)
  let total = 0
  for (let day = firstDay - 1; day <= firstDay + 2; day++) {
    const base = day * MINUTES_PER_DAY
    total += overlapLength([start, end], [base + rangeStart, base + rangeEnd])
  }
  return total
}
