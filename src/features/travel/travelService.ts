import { countCalendarDays, eachDateString, timeToMinutes } from '../../lib/date'
import type { AppData, Settings, TripEntry } from '../../lib/schema'

export const TRIP_LABELS: Record<TripEntry['tripType'], string> = { inside: '관내', outside: '관외' }

type TripTimes = Pick<TripEntry, 'date' | 'endDate' | 'startTime' | 'endTime'>

export function isMultiDayTrip(trip: Pick<TripEntry, 'date' | 'endDate'>): boolean {
  return trip.endDate > trip.date
}

/** 1박 2일 → 1 */
export function tripNights(trip: Pick<TripEntry, 'date' | 'endDate'>): number {
  return Math.max(0, countCalendarDays(trip.date, trip.endDate) - 1)
}

/** 출발부터 복귀까지 총 시간(분) */
export function tripMinutes(trip: TripTimes): number {
  return Math.max(0, tripNights(trip) * 24 * 60 + timeToMinutes(trip.endTime) - timeToMinutes(trip.startTime))
}

export interface TripAmount {
  /** null이면 금액 기준이 정해지지 않음("설정 필요") */
  amount: number | null
  label: string
}

/**
 * 출장비 (하루 기준).
 * - 당일 출장: 출장 시간이 기준(4시간) 이상/미만
 * - 여러 날 출장: 날마다 "기준 이상"으로 계산 (2026-10-19 정한 기본 규칙)
 */
export function tripAmount(trip: Pick<TripEntry, 'tripType'> & TripTimes, settings: Settings): TripAmount {
  const rates = settings.travel[trip.tripType]
  const hours = settings.travel.thresholdMinutes / 60
  if (isMultiDayTrip(trip)) {
    return { amount: rates.over, label: `${TRIP_LABELS[trip.tripType]} ${tripNights(trip)}박 ${tripNights(trip) + 1}일 (하루 ${hours}시간 이상으로 계산)` }
  }
  const over = tripMinutes(trip) >= settings.travel.thresholdMinutes
  return { amount: over ? rates.over : rates.under, label: `${TRIP_LABELS[trip.tripType]} ${hours}시간 ${over ? '이상' : '미만'}` }
}

export interface DailyTravel {
  date: string
  trips: { trip: TripEntry; amount: number | null; label: string }[]
  /** 건별 합계 (설정 필요 건 제외) */
  rawTotal: number
  /** 그날 한도: 관외 출장이 있으면 관외 한도, 아니면 관내 한도 */
  cap: number
  /** 한도 적용 후 합계 */
  total: number
  needsSetting: boolean
}

/** 그날에 걸친 출장(여러 날 출장 포함)의 출장비 */
export function dailyTravel(data: AppData, date: string): DailyTravel {
  const trips = data.entries
    .filter((entry): entry is TripEntry => entry.kind === 'trip' && entry.date <= date && entry.endDate >= date)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startTime < b.startTime ? -1 : 1))
    .map((trip) => ({ trip, ...tripAmount(trip, data.settings) }))
  const rawTotal = trips.reduce((sum, item) => sum + (item.amount ?? 0), 0)
  const hasOutside = trips.some((item) => item.trip.tripType === 'outside')
  const cap = hasOutside ? data.settings.travel.outside.dailyCap : data.settings.travel.inside.dailyCap
  return { date, trips, rawTotal, cap, total: Math.min(rawTotal, cap), needsSetting: trips.some((item) => item.amount === null) }
}

export interface MonthlyTravel {
  month: string
  days: DailyTravel[]
  total: number
  needsSetting: boolean
}

/** 해당 월 총 출장비 (급여와 별도 지급). 여러 날 출장은 그 달에 속한 날만 센다. */
export function monthlyTravel(data: AppData, month: string): MonthlyTravel {
  const dates = new Set<string>()
  for (const entry of data.entries) {
    if (entry.kind !== 'trip') continue
    for (const date of eachDateString(entry.date, entry.endDate)) if (date.startsWith(`${month}-`)) dates.add(date)
  }
  const days = [...dates].sort().map((date) => dailyTravel(data, date))
  return { month, days, total: days.reduce((sum, day) => sum + day.total, 0), needsSetting: days.some((day) => day.needsSetting) }
}
