/** 시각 입력은 30분 단위로 고른다 */
export const TIME_STEP_MINUTES = 30

// ---------- 오전/오후 · 시 · 분 나눠 고르기 ----------

export type Meridiem = 'am' | 'pm'

/** 1시 ~ 12시 */
export const HOUR12_OPTIONS: readonly number[] = Array.from({ length: 12 }, (_, index) => index + 1)

/** 00분, 30분 */
export const MINUTE_OPTIONS: readonly number[] = Array.from({ length: 60 / TIME_STEP_MINUTES }, (_, index) => index * TIME_STEP_MINUTES)

export interface TimeParts {
  meridiem: Meridiem
  /** 1 ~ 12 */
  hour: number
  minute: number
}

/** `00:30` → 오전 12시 30분, `12:00` → 오후 12시, `18:30` → 오후 6시 30분 */
export function splitTime(value: string): TimeParts {
  const [hours, minute] = value.split(':').map(Number)
  return { meridiem: hours < 12 ? 'am' : 'pm', hour: hours % 12 === 0 ? 12 : hours % 12, minute }
}

/** 오전 12시 = 00시, 오후 12시 = 12시 */
export function joinTime({ meridiem, hour, minute }: TimeParts): string {
  const hours = (hour % 12) + (meridiem === 'pm' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// ---------- 선택 가능한 시각 범위 (종료 시각 필터) ----------

/** 00:00 ~ 23:30, 30분 간격 */
export const DAY_TIMES: readonly string[] = Array.from({ length: (24 * 60) / TIME_STEP_MINUTES }, (_, index) => {
  const minutes = index * TIME_STEP_MINUTES
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

/** 고를 수 있는 시각의 범위 (양 끝 포함, `HH:mm`) */
export interface TimeBounds {
  min?: string
  max?: string
}

/**
 * 종료 시각 범위.
 * - 같은 날 종료: 시작 + 30분 ~ 23:30 (그 이전 시각은 목록에 보이지 않는다)
 * - 다음 날 종료(자정 넘김): 다음 날 00:00 ~ 시작 시각
 * 시작 시각이 없거나 잘못되면 제한하지 않는다.
 */
export function endTimeBounds(start: string, endsNextDay: boolean): TimeBounds {
  if (!/^\d{2}:\d{2}$/.test(start)) return {}
  if (endsNextDay) return { max: start }
  const [hours, minutes] = start.split(':').map(Number)
  const next = hours * 60 + minutes + TIME_STEP_MINUTES
  // 23:30 시작은 같은 날 종료할 수 없다 → 빈 범위
  return { min: next >= 24 * 60 ? '24:00' : `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}` }
}

/** 범위 안의 30분 단위 시각 */
export function timesWithin({ min, max }: TimeBounds): string[] {
  return DAY_TIMES.filter((time) => (min === undefined || time >= min) && (max === undefined || time <= max))
}

/** 같은 날 종료로 둘 수 있는 가장 이른 종료 시각 (없으면 null) */
export function earliestEnd(start: string): string | null {
  return timesWithin(endTimeBounds(start, false))[0] ?? null
}

export interface TimeChoices {
  /** 고를 수 있는 오전/오후 */
  meridiems: Meridiem[]
  /** 지금 오전/오후에서 고를 수 있는 시 (1~12 순) */
  hours: number[]
  /** 지금 오전/오후·시에서 고를 수 있는 분 */
  minutes: number[]
}

/** 허용된 시각 목록과 현재 값으로 오전/오후 · 시 · 분 선택지를 만든다. 현재 값은 범위 밖이어도 보이게 넣는다 */
export function timeChoices(allowed: readonly string[], value: string): TimeChoices {
  const current = value ? splitTime(value) : null
  const list = value && !allowed.includes(value) ? [...allowed, value] : [...allowed]
  const parts = list.map(splitTime)
  const meridiem = current?.meridiem ?? parts[0]?.meridiem ?? 'am'
  const hour = current?.hour ?? parts.find((item) => item.meridiem === meridiem)?.hour
  const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b)
  return {
    meridiems: (['am', 'pm'] as const).filter((item) => parts.some((part) => part.meridiem === item)),
    hours: unique(parts.filter((part) => part.meridiem === meridiem).map((part) => part.hour)),
    minutes: unique(parts.filter((part) => part.meridiem === meridiem && part.hour === hour).map((part) => part.minute)),
  }
}

/**
 * 한 칸을 바꿨을 때의 새 시각. 조합이 허용 범위 밖이면 바꾼 칸을 유지하는 가장 이른 허용 시각으로 맞춘다.
 * (예: 시작 09:30, 종료를 오후 → 오전으로 바꾸면 오전 10:00)
 */
export function pickTime(allowed: readonly string[], base: TimeParts, patch: Partial<TimeParts>): string {
  const wanted = joinTime({ ...base, ...patch })
  if (allowed.length === 0 || allowed.includes(wanted)) return wanted
  const meridiem = patch.meridiem ?? base.meridiem
  const sameHour = 'hour' in patch || 'minute' in patch
  const parts = allowed.map((time) => ({ time, ...splitTime(time) }))
  const match =
    (sameHour && parts.find((part) => part.meridiem === meridiem && part.hour === (patch.hour ?? base.hour))) ||
    parts.find((part) => part.meridiem === meridiem) ||
    parts[0]
  return match.time
}

/**
 * 시작·다음 날 종료 여부에 맞게 종료 시각을 맞춘다.
 * - 같은 날 종료인데 종료 ≤ 시작이면 시작 + 30분으로 (23:30 시작이면 다음 날 00:00)
 * - 다음 날 종료인데 종료 > 시작이면 다음 날 00:00으로
 * 범위 안이면(30분 단위가 아닌 기존 값 포함) 그대로 둔다.
 */
export function fitEndTime(start: string, end: string, endsNextDay: boolean): { endTime: string; endsNextDay: boolean } {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { endTime: end, endsNextDay }
  if (endsNextDay) return end <= start ? { endTime: end, endsNextDay } : { endTime: '00:00', endsNextDay }
  if (end > start) return { endTime: end, endsNextDay }
  const earliest = earliestEnd(start)
  return earliest ? { endTime: earliest, endsNextDay: false } : { endTime: '00:00', endsNextDay: true }
}
