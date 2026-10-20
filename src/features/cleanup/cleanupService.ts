import type { AppData } from '../../lib/schema'

/** 기간별 정리: 지정한 연도 범위의 기록을 지운다. 설정(급여·연차 기준·근무 유형 등)은 그대로 둔다. */

export interface CleanupSummary {
  entries: number
  todos: number
  /** 지울 할 일 중 아직 완료하지 않은 것 (지금 날짜에도 이어서 보이는 항목) */
  openTodos: number
  dayNotes: number
  mealUsages: number
  payrollRecords: number
  customHolidays: number
  total: number
}

const yearOf = (date: string) => Number(date.slice(0, 4))

/** 기록이 있는 연도 (오름차순) */
export function recordYears(data: AppData): number[] {
  const dates = [
    ...data.entries.map((entry) => entry.date),
    ...data.todos.map((todo) => todo.date),
    ...Object.keys(data.dayNotes),
    ...data.mealUsages.map((usage) => usage.sourceDate),
    ...Object.keys(data.payrollRecords),
    ...data.holidays.custom.map((holiday) => holiday.date),
  ]
  return [...new Set(dates.map(yearOf))].sort((a, b) => a - b)
}

export function cleanupYears(data: AppData, fromYear: number, toYear: number): AppData {
  const [from, to] = fromYear <= toYear ? [fromYear, toYear] : [toYear, fromYear]
  const inRange = (date: string) => yearOf(date) >= from && yearOf(date) <= to
  const removedEntryIds = new Set(data.entries.filter((entry) => inRange(entry.date)).map((entry) => entry.id))

  return {
    ...data,
    // 남는 대체휴무 사용이 지운 발생 건을 가리키면 자동 선택(기한 빠른 순)으로 돌린다
    entries: data.entries
      .filter((entry) => !removedEntryIds.has(entry.id))
      .map((entry) => (entry.kind === 'leave' && entry.compSourceId && removedEntryIds.has(entry.compSourceId) ? { ...entry, compSourceId: null } : entry)),
    todos: data.todos.filter((todo) => !inRange(todo.date)),
    dayNotes: Object.fromEntries(Object.entries(data.dayNotes).filter(([date]) => !inRange(date))),
    mealUsages: data.mealUsages.filter((usage) => !inRange(usage.sourceDate)),
    payrollRecords: Object.fromEntries(Object.entries(data.payrollRecords).filter(([month]) => !inRange(month))),
    holidays: {
      custom: data.holidays.custom.filter((holiday) => !inRange(holiday.date)),
      overrides: data.holidays.overrides.filter((item) => !inRange(item.date)),
    },
    compDismissals: data.compDismissals.filter((item) => !inRange(item.date) && !removedEntryIds.has(item.entryId)),
  }
}

export function summarizeCleanup(data: AppData, fromYear: number, toYear: number): CleanupSummary {
  const next = cleanupYears(data, fromYear, toYear)
  const removedTodos = data.todos.filter((todo) => !next.todos.includes(todo))
  const summary = {
    entries: data.entries.length - next.entries.length,
    todos: removedTodos.length,
    openTodos: removedTodos.filter((todo) => !todo.done).length,
    dayNotes: Object.keys(data.dayNotes).length - Object.keys(next.dayNotes).length,
    mealUsages: data.mealUsages.length - next.mealUsages.length,
    payrollRecords: Object.keys(data.payrollRecords).length - Object.keys(next.payrollRecords).length,
    customHolidays: data.holidays.custom.length - next.holidays.custom.length,
  }
  return { ...summary, total: summary.entries + summary.todos + summary.dayNotes + summary.mealUsages + summary.payrollRecords + summary.customHolidays }
}
