import { addDaysToDateString, isValidDateString } from '../../lib/date'
import { entrySchema, formatSchemaIssues, type AppData, type WorkCategory, type WorkEntry } from '../../lib/schema'
import { getOvertimeLimitErrors } from '../overtime/overtimeService'
import { upsertEntry } from './scheduleService'

/** 일괄 등록할 수 있는 근무 종류: 기본근무, 평일 당직, 주말 당직 */
export const BULK_WORK_CATEGORIES: readonly WorkCategory[] = ['regular', 'weekday-duty', 'weekend-duty']

/** 근무·당직 일괄 등록 입력. 시간은 선택한 모든 날짜에 똑같이 적용한다 */
export interface WorkBulkInput {
  workTypeId: string
  dates: string[]
  startTime: string
  endTime: string
  breakMinutes: number
  note: string
}

export interface WorkBulkResult {
  /** 등록 결과가 반영된 데이터 (등록한 날이 없으면 입력과 같은 객체) */
  data: AppData
  added: string[]
  /** 등록한 근무 유형 이름 (안내 문구용) */
  typeName: string
  /** 이미 근무·당직이 있어 건너뛴 날짜 */
  skippedExisting: string[]
  /** 월·주 연장근무 한도를 넘어 등록하지 않은 날짜 */
  blockedByLimit: { date: string; reasons: string[] }[]
  /** 입력 자체가 잘못되어 아무것도 등록하지 않은 경우의 오류 */
  errors: string[]
}

/** 그 날짜에 시작하는 근무(당직 포함) 일정이 있는지 */
export function hasWorkOn(data: AppData, date: string): boolean {
  return data.entries.some((entry) => entry.kind === 'work' && entry.date === date)
}

/**
 * 기본근무·당직 일괄 등록 (서버 없이 문서 하나를 갱신한다).
 * 날짜순으로 하나씩 단건 등록과 같은 규칙을 적용한다:
 * 1) 이미 근무가 있는 날은 건너뛴다  2) 일정 스키마 검증  3) 앞서 등록한 날까지 포함해 월·주 연장 한도 검사(넘으면 그 날만 차단)
 * 4) upsertEntry로 추가 → 대체휴무 기한 기록 등 단건 저장과 같은 처리
 */
export function bulkAddWork(data: AppData, input: WorkBulkInput, createId: () => string): WorkBulkResult {
  const type = data.workTypes.find((item) => item.id === input.workTypeId)
  const result: WorkBulkResult = { data, typeName: type?.name ?? '', added: [], skippedExisting: [], blockedByLimit: [], errors: [] }
  if (!type || !BULK_WORK_CATEGORIES.includes(type.category)) {
    return { ...result, errors: ['근무 종류(기본근무·평일 당직·주말 당직)를 선택하세요.'] }
  }
  const dates = [...new Set(input.dates)].filter(isValidDateString).sort()
  if (dates.length === 0) return { ...result, errors: ['등록할 날짜를 하나 이상 선택하세요.'] }

  const endsNextDay = input.endTime <= input.startTime
  let next = data
  for (const date of dates) {
    if (hasWorkOn(next, date)) {
      result.skippedExisting.push(date)
      continue
    }
    const parsed = entrySchema.safeParse({
      id: createId(),
      kind: 'work',
      date,
      endDate: endsNextDay ? addDaysToDateString(date, 1) : date,
      workTypeId: type.id,
      startTime: input.startTime,
      endTime: input.endTime,
      endsNextDay,
      breakMinutes: input.breakMinutes,
      note: input.note.trim(),
      overtime: [],
      holidayCompensation: null,
      compExpiresOn: null,
    } satisfies WorkEntry)
    if (!parsed.success) {
      // 시간 입력이 잘못되면 모든 날짜가 같은 이유로 실패하므로 아무것도 등록하지 않는다
      return { ...result, data, added: [], errors: formatSchemaIssues(parsed.error) }
    }
    const entry = parsed.data as WorkEntry
    const limitErrors = getOvertimeLimitErrors(next, entry)
    if (limitErrors.length > 0) {
      result.blockedByLimit.push({ date, reasons: limitErrors })
      continue
    }
    next = upsertEntry(next, entry)
    result.added.push(date)
  }
  return { ...result, data: next }
}

const dayLabel = (date: string) => `${Number(date.slice(8, 10))}일`

/** 처리 결과 안내 문구 */
export function describeWorkBulkResult(result: WorkBulkResult): string {
  if (result.errors.length > 0) return result.errors.join(' ')
  const parts = [`${result.typeName} ${result.added.length}일을 등록했습니다.`]
  if (result.skippedExisting.length > 0) parts.push(`${result.skippedExisting.map(dayLabel).join(', ')}은 이미 근무가 있어 건너뛰었습니다.`)
  if (result.blockedByLimit.length > 0) {
    const kinds = new Set<string>(result.blockedByLimit.flatMap((item) => item.reasons.map((reason) => (reason.startsWith('주') ? '주' : '월'))))
    const label = ['주', '월'].filter((kind) => kinds.has(kind)).join('/')
    parts.push(`${result.blockedByLimit.map((item) => dayLabel(item.date)).join(', ')}은 ${label} 초과근무 한도를 넘어 등록되지 않았습니다.`)
  }
  return parts.join(' ')
}
