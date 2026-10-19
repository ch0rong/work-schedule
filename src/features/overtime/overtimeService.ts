import { addDaysToDateString, addMonthsToMonthString, timeToMinutes } from '../../lib/date'
import { segmentRange, type AppData, type OvertimeSegment, type WorkEntry } from '../../lib/schema'
import { holidayWorkResult } from '../holidayWork/holidayWorkService'
import { calculateElapsedMinutes, dayNumber, formatMinutes, MINUTES_PER_DAY, monthRange, weekRange, type DateRange } from '../../lib/time'

// ---------- 산정 기간 ----------

/*
 * 기간 기준 두 가지를 분리한다.
 * - 한도 체크: 월(1일~말일) capMinutes, 주(월~일) weeklyCapMinutes. 넘는 입력은 저장하지 않는다.
 * - 수당 정산: 산정 기간(periodStartDay일 ~ 다음 달 전날). 급여 월 M = (M-1)월 21일 ~ M월 20일.
 * 연장근무는 근무일(entry.date)의 기간에 속한다.
 */

/** 날짜의 연장근무가 반영되는 급여 월. 시작일 21이면 8/21~9/20 → 9월 */
export function payMonthForDate(date: string, periodStartDay: number): string {
  const month = date.slice(0, 7)
  const day = Number(date.slice(8, 10))
  return periodStartDay > 1 && day >= periodStartDay ? addMonthsToMonthString(month, 1) : month
}

/** 급여 월 M의 산정 기간: (M-1)월 시작일 ~ M월 (시작일-1)일 */
export function overtimePeriod(payMonth: string, periodStartDay: number): DateRange {
  if (periodStartDay === 1) {
    const next = addMonthsToMonthString(payMonth, 1)
    return { start: `${payMonth}-01`, end: addDaysToDateString(`${next}-01`, -1) }
  }
  const day = String(periodStartDay).padStart(2, '0')
  const prev = addMonthsToMonthString(payMonth, -1)
  return { start: `${prev}-${day}`, end: addDaysToDateString(`${payMonth}-${day}`, -1) }
}

// ---------- 구간 ----------

/** 근무 구간 [시작, 종료) — 근무일 0시 기준 분 */
export function workRange(entry: WorkEntry): [number, number] {
  const start = timeToMinutes(entry.startTime)
  return [start, start + calculateElapsedMinutes(entry)]
}

export function segmentMinutes(segment: OvertimeSegment): number {
  const [start, end] = segmentRange(segment)
  return Math.max(0, end - start)
}

export function overtimeMinutes(entry: WorkEntry): number {
  return entry.overtime.reduce((sum, segment) => sum + segmentMinutes(segment), 0)
}

/** 근무 종료 후 연장근무 분 (매식비 기준) */
export function afterWorkOvertimeMinutes(entry: WorkEntry): number {
  const [, workEnd] = workRange(entry)
  return entry.overtime
    .filter((segment) => segmentRange(segment)[0] >= workEnd)
    .reduce((sum, segment) => sum + segmentMinutes(segment), 0)
}

export function overtimeAmount(minutes: number, hourlyRate: number): number {
  return Math.round((minutes * hourlyRate) / 60)
}

/** 다음 구간을 근무 종료 직후(없으면 마지막 구간 직후)로 제안 */
export function suggestNextSegment(entry: Pick<WorkEntry, 'startTime' | 'endTime' | 'endsNextDay' | 'overtime'>, unitMinutes: number): OvertimeSegment {
  const workEnd = timeToMinutes(entry.endTime) + (entry.endsNextDay ? MINUTES_PER_DAY : 0)
  const lastEnd = Math.max(workEnd, ...entry.overtime.map((segment) => segmentRange(segment)[1]))
  const end = lastEnd + unitMinutes
  const fmt = (value: number) => {
    const inDay = ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
    return `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`
  }
  return { startTime: fmt(lastEnd), endTime: fmt(end), endsNextDay: end > MINUTES_PER_DAY }
}

// ---------- 한도 (월 1일~말일, 주 월~일) ----------

/** 주 한도는 월요일 시작 */
const WEEK_STARTS_ON_MONDAY = 1

export function capWeek(date: string): DateRange {
  return weekRange(date, WEEK_STARTS_ON_MONDAY)
}

export function capMonth(date: string): DateRange {
  return monthRange(date.slice(0, 7))
}

interface OvertimeItem {
  entryId: string
  date: string
  /** 정렬용 절대 시각(분) */
  start: number
  minutes: number
  source: 'overtime' | 'holiday-allowance'
  countsTowardCap: boolean
}

/**
 * 한도·수당 대상 시간.
 * - 연장근무 구간: 휴일근무를 뺀 모든 근무 유형에서 한도 포함
 * - 휴일근무: 연장근무 구간은 인정하지 않는다(최대 8시간). 보상은 holidayWorkResult로 분기
 *   - 8시간 미만 → 실근무만큼 수당, 한도 포함
 *   - 8시간 이상 + 수당 → 인정 시간(기본 7.5시간) 수당, 한도 포함은 설정
 *   - 대체휴무·출장(대체휴무) → 수당 없음, 한도 제외
 */
function overtimeItems(data: AppData): OvertimeItem[] {
  const typeById = new Map(data.workTypes.map((type) => [type.id, type]))
  const items: OvertimeItem[] = []
  for (const entry of data.entries) {
    if (entry.kind !== 'work') continue
    const base = dayNumber(entry.date) * MINUTES_PER_DAY
    if (typeById.get(entry.workTypeId)?.category === 'holiday-work') {
      const result = holidayWorkResult(entry, data.settings)
      if (result.allowanceMinutes > 0) {
        items.push({
          entryId: entry.id,
          date: entry.date,
          start: base + timeToMinutes(entry.startTime),
          minutes: result.allowanceMinutes,
          source: 'holiday-allowance',
          countsTowardCap: result.countsTowardCap,
        })
      }
      continue
    }
    for (const segment of entry.overtime) {
      const [start, end] = segmentRange(segment)
      items.push({ entryId: entry.id, date: entry.date, start: base + start, minutes: end - start, source: 'overtime', countsTowardCap: true })
    }
  }
  return items.sort((a, b) => a.start - b.start)
}

export interface CapUsage {
  range: DateRange
  capMinutes: number
  /** 한도 계산에 포함된 합계 */
  countedMinutes: number
  remainingMinutes: number
  exceededMinutes: number
}

function usage(items: OvertimeItem[], range: DateRange, capMinutes: number): CapUsage {
  const countedMinutes = items
    .filter((item) => item.countsTowardCap && item.date >= range.start && item.date <= range.end)
    .reduce((sum, item) => sum + item.minutes, 0)
  return {
    range,
    capMinutes,
    countedMinutes,
    remainingMinutes: Math.max(0, capMinutes - countedMinutes),
    exceededMinutes: Math.max(0, countedMinutes - capMinutes),
  }
}

/** 날짜가 속한 월(1일~말일)·주(월~일)의 한도 사용량 */
export function capUsage(data: AppData, date: string): { month: CapUsage; week: CapUsage } {
  const items = overtimeItems(data)
  const { capMinutes, weeklyCapMinutes } = data.settings.overtime
  return { month: usage(items, capMonth(date), capMinutes), week: usage(items, capWeek(date), weeklyCapMinutes) }
}

/**
 * 저장하려는 근무가 월·주 한도를 넘기면 오류(저장 차단).
 * 이미 한도를 넘은 과거 데이터는 그대로 두고, 이번 저장으로 한도 대상 시간이 늘어날 때만 막는다.
 */
export function getOvertimeLimitErrors(data: AppData, candidate: WorkEntry): string[] {
  const next: AppData = { ...data, entries: [...data.entries.filter((entry) => entry.id !== candidate.id), candidate] }
  const before = capUsage(data, candidate.date)
  const after = capUsage(next, candidate.date)
  const errors: string[] = []
  const check = (label: string, prev: CapUsage, now: CapUsage) => {
    if (now.countedMinutes > now.capMinutes && now.countedMinutes > prev.countedMinutes) {
      errors.push(
        `${label}(${now.range.start} ~ ${now.range.end}) 연장근무가 ${formatMinutes(now.countedMinutes)}으로 한도 ${formatMinutes(now.capMinutes)}를 ${formatMinutes(now.exceededMinutes)} 넘습니다. 저장할 수 없습니다.`,
      )
    }
  }
  check('월 한도', before.month, after.month)
  check('주 한도', before.week, after.week)
  return errors
}

// ---------- 수당 정산 (산정 기간) ----------

export interface OvertimeRecord {
  entryId: string
  date: string
  source: 'overtime' | 'holiday-allowance'
  minutes: number
  /** 월·주 한도 안에서 인정된 분 */
  recognizedMinutes: number
  /** 이 기록까지 그 달(1일~말일)의 한도 누적 분 */
  monthCumulativeMinutes: number
  /** 이 기록까지 그 주(월~일)의 한도 누적 분 */
  weekCumulativeMinutes: number
  amount: number
}

export interface OvertimeSummary {
  payMonth: string
  /** 수당 정산 기간 */
  period: DateRange
  /** 연장근무 입력 합계 (휴일근무 수당분 제외) */
  overtimeMinutes: number
  recognizedMinutes: number
  /** 한도를 넘어 미인정된 분 (저장 차단 전에 입력된 데이터 등) */
  unrecognizedMinutes: number
  overtimeAmount: number
  holidayAllowance: { count: number; minutes: number; amount: number }
  records: OvertimeRecord[]
}

/**
 * 전체 기록을 시간순으로 누적해 월·주 한도를 적용(넘는 분은 미인정 0원)한 뒤,
 * 급여 월의 산정 기간에 속한 기록만 모아 수당을 계산한다.
 */
export function summarizeOvertime(data: AppData, payMonth: string): OvertimeSummary {
  const rules = data.settings.overtime
  const period = overtimePeriod(payMonth, rules.periodStartDay)
  const monthCounted = new Map<string, number>()
  const weekCounted = new Map<string, number>()

  const all: OvertimeRecord[] = overtimeItems(data).map((item) => {
    const monthKey = item.date.slice(0, 7)
    const weekKey = capWeek(item.date).start
    const month = monthCounted.get(monthKey) ?? 0
    const week = weekCounted.get(weekKey) ?? 0
    let recognizedMinutes = item.minutes
    if (item.countsTowardCap) {
      recognizedMinutes = Math.max(0, Math.min(item.minutes, rules.capMinutes - month, rules.weeklyCapMinutes - week))
      monthCounted.set(monthKey, month + item.minutes)
      weekCounted.set(weekKey, week + item.minutes)
    }
    return {
      entryId: item.entryId,
      date: item.date,
      source: item.source,
      minutes: item.minutes,
      recognizedMinutes,
      monthCumulativeMinutes: monthCounted.get(monthKey) ?? 0,
      weekCumulativeMinutes: weekCounted.get(weekKey) ?? 0,
      amount: overtimeAmount(recognizedMinutes, rules.hourlyRate),
    }
  })

  const records = all.filter((record) => record.date >= period.start && record.date <= period.end)
  const overtimeRecords = records.filter((record) => record.source === 'overtime')
  const holidayRecords = records.filter((record) => record.source === 'holiday-allowance')
  const sum = (list: OvertimeRecord[], key: 'minutes' | 'recognizedMinutes' | 'amount') => list.reduce((total, record) => total + record[key], 0)
  return {
    payMonth,
    period,
    overtimeMinutes: sum(overtimeRecords, 'minutes'),
    recognizedMinutes: sum(records, 'recognizedMinutes'),
    unrecognizedMinutes: sum(records, 'minutes') - sum(records, 'recognizedMinutes'),
    overtimeAmount: sum(overtimeRecords, 'amount'),
    holidayAllowance: {
      count: holidayRecords.length,
      minutes: sum(holidayRecords, 'recognizedMinutes'),
      amount: sum(holidayRecords, 'amount'),
    },
    records,
  }
}
