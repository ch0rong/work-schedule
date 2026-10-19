import { useMemo } from 'react'
import { buildHolidayMap, isHolidayIn, type HolidayMap } from '../lib/holidays'
import { useAppState } from './storeContext'

/** 법정공휴일 + 사용자 추가 휴일 */
export function useHolidays(): { map: HolidayMap; isHoliday: (date: string) => boolean } {
  const { data } = useAppState()
  const { custom, overrides } = data.holidays
  return useMemo(() => {
    const map = buildHolidayMap(custom, overrides)
    return { map, isHoliday: (date: string) => isHolidayIn(map, date) }
  }, [custom, overrides])
}
