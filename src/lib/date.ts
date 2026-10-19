import { addDays, eachDayOfInterval, format, isValid, isWeekend, parse } from 'date-fns'

/** 저장 형식: 날짜 `YYYY-MM-DD`, 시간 `HH:mm` */
export const DATE_FORMAT = 'yyyy-MM-dd'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** 문자열을 로컬 자정의 Date로 바꾼다. 형식이 틀리거나 존재하지 않는 날짜(예: 2026-02-30)면 null. */
export function parseDateString(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null
  const date = parse(value, DATE_FORMAT, new Date(2000, 0, 1))
  if (!isValid(date) || format(date, DATE_FORMAT) !== value) return null
  return date
}

export function isValidDateString(value: string): boolean {
  return parseDateString(value) !== null
}

export function isValidTimeString(value: string): boolean {
  return TIME_PATTERN.test(value)
}

/** `HH:mm`을 자정 기준 분으로 바꾼다. */
export function timeToMinutes(value: string): number {
  if (!isValidTimeString(value)) throw new Error(`잘못된 시간 형식: ${value}`)
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function toDateString(date: Date): string {
  return format(date, DATE_FORMAT)
}

export function addDaysToDateString(value: string, days: number): string {
  const date = parseDateString(value)
  if (!date) throw new Error(`잘못된 날짜 형식: ${value}`)
  return toDateString(addDays(date, days))
}

/** 같은 형식의 날짜 문자열은 사전순 비교가 날짜순 비교와 같다. */
export function compareDateStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 시작일~종료일(포함) 날짜 목록 */
export function eachDateString(start: string, end: string): string[] {
  const from = parseDateString(start)
  const to = parseDateString(end)
  if (!from || !to || to < from) return []
  return eachDayOfInterval({ start: from, end: to }).map(toDateString)
}

export function countCalendarDays(start: string, end: string): number {
  return eachDateString(start, end).length
}

export function isWeekendDate(date: string): boolean {
  const parsed = parseDateString(date)
  return parsed !== null && isWeekend(parsed)
}

/** `YYYY-MM`에 월을 더한다. */
export function addMonthsToMonthString(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number)
  const index = year * 12 + (mon - 1) + delta
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}
