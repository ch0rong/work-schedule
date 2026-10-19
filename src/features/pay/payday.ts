import { getDaysInMonth } from 'date-fns'
import { addDaysToDateString, isWeekendDate, parseDateString } from '../../lib/date'

/**
 * 급여 지급일: 해당 월 `payday`일(말일보다 크면 말일).
 * 주말 또는 휴일이면 직전 영업일로 앞당긴다.
 */
export function paydayDate(month: string, payday: number, isHoliday: (date: string) => boolean): string {
  const first = parseDateString(`${month}-01`)
  if (!first) throw new Error(`잘못된 월 형식: ${month}`)
  const day = Math.min(payday, getDaysInMonth(first))
  let date = `${month}-${String(day).padStart(2, '0')}`
  // 연휴가 길어도 최대 한 달 안에서 멈춘다
  for (let guard = 0; guard < 31 && (isWeekendDate(date) || isHoliday(date)); guard++) {
    date = addDaysToDateString(date, -1)
  }
  return date
}
