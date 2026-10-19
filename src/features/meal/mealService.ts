import type { AppData, MealUsage, Settings, WorkEntry } from '../../lib/schema'
import { formatMinutes } from '../../lib/time'
import { holidayWorkResult } from '../holidayWork/holidayWorkService'
import { afterWorkOvertimeMinutes } from '../overtime/overtimeService'

export interface MealOccurrence {
  date: string
  /** 발생 사유: `종료 후 연장 1시간`, `휴일근무 4시간` */
  reason: string
  usage: MealUsage | null
}

/** 휴일근무 실근무가 기준(기본 4시간) 이상이면 매식비 발생 */
export function holidayWorkEarnsMeal(entry: WorkEntry, settings: Settings): boolean {
  return holidayWorkResult(entry, settings).netMinutes >= settings.meal.holidayMinWorkMinutes
}

/**
 * 매식비 발생일과 사유 (하루 1건)
 * - 근무 종료 후 연장근무가 기준 이상인 날 (휴일근무는 연장근무를 인정하지 않으므로 제외)
 * - 휴일근무 실근무가 기준 이상인 날
 */
export function mealOccurrenceDates(data: AppData): Map<string, string> {
  const typeById = new Map(data.workTypes.map((type) => [type.id, type]))
  const overtimeByDate = new Map<string, number>()
  const reasons = new Map<string, string>()
  for (const entry of data.entries) {
    if (entry.kind !== 'work') continue
    if (typeById.get(entry.workTypeId)?.category === 'holiday-work') {
      if (holidayWorkEarnsMeal(entry, data.settings)) reasons.set(entry.date, `휴일근무 ${formatMinutes(holidayWorkResult(entry, data.settings).netMinutes)}`)
      continue
    }
    overtimeByDate.set(entry.date, (overtimeByDate.get(entry.date) ?? 0) + afterWorkOvertimeMinutes(entry))
  }
  for (const [date, minutes] of overtimeByDate) {
    if (minutes > 0 && minutes >= data.settings.meal.minOvertimeMinutes && !reasons.has(date)) reasons.set(date, `종료 후 연장 ${formatMinutes(minutes)}`)
  }
  return reasons
}

export interface MealMonthSummary {
  month: string
  occurrences: MealOccurrence[]
  occurred: number
  used: number
  remaining: number
  /** 발생 건이 사라진(연장근무 삭제 등) 사용 내역 */
  orphanUsages: MealUsage[]
}

/** 월별(1일~말일) 매식비 발생·사용·잔여 */
export function summarizeMeals(data: AppData, month: string): MealMonthSummary {
  const dates = mealOccurrenceDates(data)
  const usageBySource = new Map(data.mealUsages.map((usage) => [usage.sourceDate, usage]))
  const occurrences = [...dates.entries()]
    .filter(([date]) => date.startsWith(`${month}-`))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, reason]) => ({ date, reason, usage: usageBySource.get(date) ?? null }))
  const used = occurrences.filter((occurrence) => occurrence.usage?.used).length
  const orphanUsages = data.mealUsages.filter((usage) => usage.sourceDate.startsWith(`${month}-`) && !dates.has(usage.sourceDate))
  return { month, occurrences, occurred: occurrences.length, used, remaining: occurrences.length - used, orphanUsages }
}

/** 사용 내역 검증: 이월 불가 설정이면 같은 달 안에서만 사용 */
export function validateMealUsage(data: AppData, usage: MealUsage): string[] {
  const errors: string[] = []
  if (!mealOccurrenceDates(data).has(usage.sourceDate)) errors.push(`${usage.sourceDate}에는 매식비 발생 건이 없습니다.`)
  if (usage.usedDate) {
    if (usage.usedDate < usage.sourceDate) errors.push('사용일은 발생일과 같거나 이후여야 합니다.')
    if (!data.settings.meal.allowCarryOver && usage.usedDate.slice(0, 7) !== usage.sourceDate.slice(0, 7)) {
      errors.push('매식비는 발생한 달 안에서만 사용할 수 있습니다. (마이페이지에서 이월 허용 설정 가능)')
    }
  }
  return errors
}

export function upsertMealUsage(data: AppData, usage: MealUsage): AppData {
  const exists = data.mealUsages.some((item) => item.id === usage.id)
  return {
    ...data,
    mealUsages: exists ? data.mealUsages.map((item) => (item.id === usage.id ? usage : item)) : [...data.mealUsages, usage],
  }
}

export function removeMealUsage(data: AppData, id: string): AppData {
  return { ...data, mealUsages: data.mealUsages.filter((usage) => usage.id !== id) }
}
