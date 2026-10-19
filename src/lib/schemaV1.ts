/**
 * 스키마 v1 (로컬 저장 버전). v1 데이터를 검증한 뒤 v2로 변환할 때만 사용한다. 수정하지 않는다.
 */
import { z } from 'zod'
import { addDaysToDateString, isValidDateString, isValidTimeString } from './date'
import { calculateElapsedMinutes } from './time'

const SCHEMA_VERSION = 1

const dateString = z.string().refine(isValidDateString, '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.')
const timeString = z.string().refine(isValidTimeString, '시간은 HH:mm 형식이어야 합니다.')
const id = z.string().min(1, 'ID가 비어 있습니다.')
const won = z.number().int('금액은 원 단위 정수여야 합니다.').min(0, '금액은 0 이상이어야 합니다.')
const note = z.string().max(1000, '메모는 1000자 이하로 입력하세요.')
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '색상은 #RRGGBB 형식이어야 합니다.')
const halfStep = z
  .number()
  .min(0, '0 이상이어야 합니다.')
  .refine((value) => Number.isInteger(value * 2), '0.5 단위로 입력하세요.')

// ---------- 근무 유형 ----------
export const workTypeSchema = z.object({
  id,
  name: z.string().trim().min(1, '이름을 입력하세요.').max(30, '이름은 30자 이하로 입력하세요.'),
  color,
  countsAsWork: z.boolean(),
  /** 일정에서 참조 중인 유형은 삭제 대신 비활성화한다. */
  archived: z.boolean(),
})

// ---------- 일정 ----------
export const LEAVE_TYPES = ['annual', 'half-am', 'half-pm', 'sick', 'other'] as const

export const workEntrySchema = z.object({
  id,
  kind: z.literal('work'),
  date: dateString,
  endDate: dateString,
  workTypeId: id,
  startTime: timeString,
  endTime: timeString,
  endsNextDay: z.boolean(),
  breakMinutes: z.number().int('휴게시간은 분 단위 정수여야 합니다.').min(0, '휴게시간은 0분 이상이어야 합니다.'),
  note,
})

export const leaveEntrySchema = z.object({
  id,
  kind: z.literal('leave'),
  leaveType: z.enum(LEAVE_TYPES),
  date: dateString,
  endDate: dateString,
  leaveUnits: halfStep,
  note,
})

export const entrySchema = z
  .discriminatedUnion('kind', [workEntrySchema, leaveEntrySchema])
  .superRefine((entry, ctx) => {
    if (!isValidDateString(entry.date) || !isValidDateString(entry.endDate)) return

    if (entry.kind === 'work') {
      if (!isValidTimeString(entry.startTime) || !isValidTimeString(entry.endTime)) return
      const expectedEnd = entry.endsNextDay ? addDaysToDateString(entry.date, 1) : entry.date
      if (entry.endDate !== expectedEnd) {
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료 날짜가 다음 날 종료 설정과 맞지 않습니다.' })
      }
      const elapsed = calculateElapsedMinutes(entry)
      if (elapsed <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['endTime'],
          message: '종료 시각이 시작 시각보다 늦어야 합니다. 자정을 넘기면 "다음 날 종료"를 선택하세요.',
        })
      } else if (entry.breakMinutes > elapsed) {
        ctx.addIssue({ code: 'custom', path: ['breakMinutes'], message: '휴게시간이 근무 경과시간보다 깁니다.' })
      }
      return
    }

    if (entry.endDate < entry.date) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료일은 시작일과 같거나 이후여야 합니다.' })
    }
    if (entry.date.slice(0, 4) !== entry.endDate.slice(0, 4)) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '연도를 넘기는 휴가는 연도별로 나누어 등록하세요.' })
    }
    if ((entry.leaveType === 'half-am' || entry.leaveType === 'half-pm') && entry.date !== entry.endDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '반차는 하루만 등록할 수 있습니다.' })
    }
  })

// ---------- 급여 ----------
const appliesToSchema = z.object({
  /** 비어 있으면 근무시간에 포함되는 모든 유형에 적용 */
  workTypeIds: z.array(id),
  /** 이 시간대와 겹치는 근무시간에만 적용 (예: 22:00~06:00). null이면 시간대 제한 없음 */
  timeRange: z.object({ start: timeString, end: timeString }).nullable(),
})

const ruleBase = {
  id,
  name: z.string().trim().min(1, '수당명을 입력하세요.').max(30, '수당명은 30자 이하로 입력하세요.'),
  enabled: z.boolean(),
  appliesTo: appliesToSchema,
}

export const allowanceRuleSchema = z.discriminatedUnion(
  'method',
  [
    /** 고정 금액: 월 1회 또는 조건에 맞는 근무일마다 */
    z.object({ ...ruleBase, method: z.literal('fixed'), amount: won, frequency: z.enum(['perMonth', 'perWorkDay']) }),
    /** 시간당 금액: 조건에 맞는 근무시간 × 금액 */
    z.object({ ...ruleBase, method: z.literal('perHour'), amount: won }),
    /** 기본급 비율: 조건에 맞는 근무시간 × 기준 시급 × 배율 */
    z.object({
      ...ruleBase,
      method: z.literal('multiplier'),
      rate: z.number().positive('배율은 0보다 커야 합니다.').max(10, '배율은 10 이하로 입력하세요.'),
    }),
  ],
  { error: '지원하지 않는 수당 계산 방식입니다. (fixed, perHour, multiplier만 지원)' },
)

export const paySettingsSchema = z.object({
  mode: z.enum(['hourly', 'monthly']),
  hourlyRate: won,
  monthlySalary: won,
  monthlyStandardMinutes: z.number().int().positive('월 소정근로시간은 0보다 커야 합니다.'),
  fixedAllowances: won,
  estimatedDeductions: won,
  rules: z.array(allowanceRuleSchema),
})

// ---------- 설정 ----------
export const annualLeaveSettingSchema = z.object({
  grantedDays: halfStep,
  /** 연차 사용 최소 단위. half-day면 반차(0.5일) 허용 */
  unitPolicy: z.enum(['half-day', 'full-day']),
})

export const settingsSchema = z.object({
  currency: z.literal('KRW'),
  defaultView: z.enum(['dayGridMonth', 'timeGridWeek']),
  weekStartsOn: z.number().int().min(0).max(6),
  pay: paySettingsSchema,
  annualLeaveByYear: z.record(z.string().regex(/^\d{4}$/, '연도는 4자리 숫자여야 합니다.'), annualLeaveSettingSchema),
})

// ---------- 전체 문서 ----------
export const appDataSchemaV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    settings: settingsSchema,
    workTypes: z.array(workTypeSchema),
    entries: z.array(entrySchema),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((data, ctx) => {
    const typeIds = new Set<string>()
    data.workTypes.forEach((type, index) => {
      if (typeIds.has(type.id)) {
        ctx.addIssue({ code: 'custom', path: ['workTypes', index, 'id'], message: `근무 유형 ID가 중복됩니다: ${type.id}` })
      }
      typeIds.add(type.id)
    })

    const entryIds = new Set<string>()
    data.entries.forEach((entry, index) => {
      if (entryIds.has(entry.id)) {
        ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: `일정 ID가 중복됩니다: ${entry.id}` })
      }
      entryIds.add(entry.id)
      if (entry.kind === 'work' && !typeIds.has(entry.workTypeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'workTypeId'],
          message: `존재하지 않는 근무 유형을 참조합니다: ${entry.workTypeId}`,
        })
      }
    })

    data.settings.pay.rules.forEach((rule, index) => {
      for (const typeId of rule.appliesTo.workTypeIds) {
        if (!typeIds.has(typeId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['settings', 'pay', 'rules', index, 'appliesTo'],
            message: `수당 규칙 "${rule.name}"이(가) 존재하지 않는 근무 유형을 참조합니다: ${typeId}`,
          })
        }
      }
    })
  })

export type AppDataV1 = z.infer<typeof appDataSchemaV1>
