import type { CustomHoliday, HolidayOverride } from './schema'
import { OFFICIAL_HOLIDAYS } from './holidayData'

export interface Holiday {
  date: string
  name: string
  /** official: 법정공휴일, substitute: 대체공휴일, custom: 사용자 추가 */
  kind: 'official' | 'substitute' | 'custom'
  /** 사용자가 이름을 바꾼 법정공휴일이면 원래 이름 */
  originalName?: string
}

/** 날짜 → 그날의 휴일 목록 */
export type HolidayMap = ReadonlyMap<string, readonly Holiday[]>

/** 법정공휴일 이름에 사용자 수정을 적용한다 (날짜·휴일 여부는 그대로) */
export function officialHolidayName(date: string, name: string, overrides: readonly HolidayOverride[]): { name: string; originalName?: string } {
  const override = overrides.find((item) => item.date === date && item.originalName === name)
  return override ? { name: override.name, originalName: name } : { name }
}

export function buildHolidayMap(custom: readonly CustomHoliday[], overrides: readonly HolidayOverride[] = []): HolidayMap {
  const map = new Map<string, Holiday[]>()
  const add = (holiday: Holiday) => map.set(holiday.date, [...(map.get(holiday.date) ?? []), holiday])
  for (const holidays of Object.values(OFFICIAL_HOLIDAYS)) {
    for (const holiday of holidays) {
      add({ date: holiday.date, ...officialHolidayName(holiday.date, holiday.name, overrides), kind: holiday.substitute ? 'substitute' : 'official' })
    }
  }
  for (const holiday of custom) add({ date: holiday.date, name: holiday.name, kind: 'custom' })
  return map
}

/** 법정공휴일 이름 수정을 저장한다. 원래 이름과 같거나 빈 이름이면 수정 기록을 지운다(원래대로) */
export function renameOfficialHoliday(overrides: readonly HolidayOverride[], date: string, originalName: string, name: string): HolidayOverride[] {
  const rest = overrides.filter((item) => !(item.date === date && item.originalName === originalName))
  const trimmed = name.trim()
  return trimmed === '' || trimmed === originalName ? rest : [...rest, { date, originalName, name: trimmed }]
}

export function isHolidayIn(map: HolidayMap, date: string): boolean {
  return (map.get(date)?.length ?? 0) > 0
}

/** 공휴일 데이터가 포함된 연도 */
export function officialHolidayYears(): string[] {
  return Object.keys(OFFICIAL_HOLIDAYS).sort()
}
