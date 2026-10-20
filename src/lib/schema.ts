import { z } from 'zod'
import { addDaysToDateString, isValidDateString, isValidTimeString, timeToMinutes, toDateString } from './date'
import { calculateElapsedMinutes, MINUTES_PER_DAY } from './time'

/** 데이터 구조 설명은 DATABASE.md 참고 */
export const SCHEMA_VERSION = 2

const dateString = z.string().refine(isValidDateString, '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.')
const timeString = z.string().refine(isValidTimeString, '시간은 HH:mm 형식이어야 합니다.')
const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '월은 YYYY-MM 형식이어야 합니다.')
const id = z.string().min(1, 'ID가 비어 있습니다.')
const won = z.number().int('금액은 원 단위 정수여야 합니다.').min(0, '금액은 0 이상이어야 합니다.')
const minutes = z.number().int('시간은 분 단위 정수여야 합니다.').min(0, '0분 이상이어야 합니다.')
const note = z.string().max(1000, '메모는 1000자 이하로 입력하세요.')
const label = (what: string) => z.string().trim().min(1, `${what}을(를) 입력하세요.`).max(30, `${what}은(는) 30자 이하로 입력하세요.`)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '색상은 #RRGGBB 형식이어야 합니다.')

// ---------- 근무 유형 ----------
export const WORK_CATEGORIES = ['regular', 'flex', 'weekday-duty', 'weekend-duty', 'holiday-work', 'off', 'custom'] as const

export const workTypeSchema = z.object({
  id,
  name: label('이름'),
  color,
  countsAsWork: z.boolean(),
  /** 일정에서 참조 중인 유형은 삭제 대신 숨긴다. */
  archived: z.boolean(),
  /** 기본 시간·보상 규칙을 정하는 분류 */
  category: z.enum(WORK_CATEGORIES),
})

// ---------- 일정 ----------
export const overtimeSegmentSchema = z.object({
  startTime: timeString,
  endTime: timeString,
  /** 종료 시각이 근무일 다음 날인지 */
  endsNextDay: z.boolean(),
})

export const HOLIDAY_COMPENSATIONS = ['allowance', 'comp-leave', 'trip-comp'] as const

export const workEntrySchema = z.object({
  id,
  kind: z.literal('work'),
  date: dateString,
  endDate: dateString,
  workTypeId: id,
  startTime: timeString,
  endTime: timeString,
  endsNextDay: z.boolean(),
  breakMinutes: minutes,
  note,
  /** 근무 시작 전·종료 후 연장근무 구간 */
  overtime: z.array(overtimeSegmentSchema).max(6, '연장근무 구간은 6개까지 입력할 수 있습니다.'),
  /** 휴일근무 보상 방식. 휴일근무가 아니면 null. trip-comp: 출장(대체휴무) — 연장 한도 제외 */
  holidayCompensation: z.enum(HOLIDAY_COMPENSATIONS).nullable(),
  /** 대체휴무가 발생하는 근무의 원칙상 사용 기한(발생일 + 기한 개월). 지나도 사용은 막지 않는다. 그 외 null */
  compExpiresOn: dateString.nullable().default(null),
})

export const LEAVE_TYPES = ['annual', 'half-am', 'half-pm', 'outing', 'early-leave', 'official', 'sick', 'special', 'comp'] as const
/** 하루 안에서만 쓰는 휴가 유형 */
export const SINGLE_DAY_LEAVE_TYPES: readonly LeaveType[] = ['half-am', 'half-pm', 'outing', 'early-leave']

export const leaveEntrySchema = z.object({
  id,
  kind: z.literal('leave'),
  leaveType: z.enum(LEAVE_TYPES),
  date: dateString,
  endDate: dateString,
  startTime: timeString.nullable(),
  endTime: timeString.nullable(),
  /** 사용량(분). 연차 1일 = settings.leave.minutesPerDay */
  minutes: z.number().int('사용 시간은 분 단위 정수여야 합니다.').positive('사용 시간을 입력하세요.'),
  specialTypeId: id.nullable(),
  /** 대체휴무 사용: 어느 발생 건(주말 당직·휴일근무 일정 id)을 쓰는지. null이면 기한이 빠른 순으로 자동 */
  compSourceId: id.nullable().default(null),
  note,
})

export const tripEntrySchema = z.object({
  id,
  kind: z.literal('trip'),
  date: dateString,
  endDate: dateString,
  tripType: z.enum(['inside', 'outside']),
  startTime: timeString,
  endTime: timeString,
  note,
})

/** [시작, 종료) 분 — 근무일 0시 기준 */
export function segmentRange(segment: { startTime: string; endTime: string; endsNextDay: boolean }): [number, number] {
  const start = timeToMinutes(segment.startTime)
  return [start, timeToMinutes(segment.endTime) + (segment.endsNextDay ? MINUTES_PER_DAY : 0)]
}

export const entrySchema = z
  .discriminatedUnion('kind', [workEntrySchema, leaveEntrySchema, tripEntrySchema])
  .superRefine((entry, ctx) => {
    if (!isValidDateString(entry.date) || !isValidDateString(entry.endDate)) return
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })

    if (entry.kind === 'work') {
      if (!isValidTimeString(entry.startTime) || !isValidTimeString(entry.endTime)) return
      const expectedEnd = entry.endsNextDay ? addDaysToDateString(entry.date, 1) : entry.date
      if (entry.endDate !== expectedEnd) issue(['endDate'], '종료 날짜가 다음 날 종료 설정과 맞지 않습니다.')
      const elapsed = calculateElapsedMinutes(entry)
      if (elapsed <= 0) {
        issue(['endTime'], '종료 시각이 시작 시각보다 늦어야 합니다. 자정을 넘기면 "다음 날 종료"를 선택하세요.')
        return
      }
      if (entry.breakMinutes > elapsed) issue(['breakMinutes'], '휴게시간이 근무 경과시간보다 깁니다.')

      // 연장근무 구간: 길이 > 0, 정규 근무·다른 구간과 겹치지 않음, 근무 시작 전 또는 종료 후
      const work: [number, number] = [timeToMinutes(entry.startTime), timeToMinutes(entry.startTime) + elapsed]
      const ranges: [number, number][] = []
      entry.overtime.forEach((segment, index) => {
        if (!isValidTimeString(segment.startTime) || !isValidTimeString(segment.endTime)) return
        const range = segmentRange(segment)
        if (range[1] <= range[0]) {
          issue(['overtime', index, 'endTime'], '연장근무 종료 시각이 시작 시각보다 늦어야 합니다.')
          return
        }
        if (range[0] < work[1] && work[0] < range[1]) {
          issue(['overtime', index], '연장근무는 근무 시작 전이나 종료 후로 입력하세요.')
        }
        if (ranges.some(([s, e]) => range[0] < e && s < range[1])) {
          issue(['overtime', index], '연장근무 구간이 서로 겹칩니다.')
        }
        ranges.push(range)
      })
      return
    }

    if (entry.kind === 'trip') {
      if (entry.endDate < entry.date) issue(['endDate'], '복귀일은 출발일과 같거나 이후여야 합니다.')
      else if (addDaysToDateString(entry.date, 30) < entry.endDate) issue(['endDate'], '출장 기간은 31일 이내로 입력하세요.')
      else if (entry.endDate === entry.date && isValidTimeString(entry.startTime) && isValidTimeString(entry.endTime) && entry.endTime <= entry.startTime) {
        issue(['endTime'], '출장 종료 시각이 시작 시각보다 늦어야 합니다.')
      }
      return
    }

    if (entry.endDate < entry.date) issue(['endDate'], '종료일은 시작일과 같거나 이후여야 합니다.')
    if (entry.date.slice(0, 4) !== entry.endDate.slice(0, 4)) issue(['endDate'], '연도를 넘기는 휴가는 연도별로 나누어 등록하세요.')
    if (SINGLE_DAY_LEAVE_TYPES.includes(entry.leaveType) && entry.date !== entry.endDate) {
      issue(['endDate'], '반차·외출·조퇴는 하루만 등록할 수 있습니다.')
    }
    if ((entry.startTime === null) !== (entry.endTime === null)) {
      issue(['endTime'], '시작·종료 시각을 모두 입력하거나 모두 비워 두세요.')
    } else if (entry.startTime && entry.endTime && entry.endTime <= entry.startTime) {
      issue(['endTime'], '종료 시각이 시작 시각보다 늦어야 합니다.')
    }
    if ((entry.leaveType === 'special') !== (entry.specialTypeId !== null)) {
      issue(['specialTypeId'], '특별휴가는 특별휴가 유형을 선택해야 합니다.')
    }
  })

// ---------- 급여 ----------
export const DEDUCTION_BASES = ['base-salary', 'fixed-pay', 'gross'] as const

export const payItemSchema = z.object({
  id,
  name: label('항목명'),
  amount: won,
  /** 비과세 항목이면 소득세 과세급여에서 뺀다. 이전 데이터에 없으면 과세 */
  taxFree: z.boolean().default(false),
})

export const deductionSchema = z.object({
  id,
  name: label('공제 항목명'),
  method: z.enum(['amount', 'rate']),
  /** amount: 원, rate: 퍼센트 */
  value: z.number().min(0, '0 이상이어야 합니다.').max(100_000_000, '값이 너무 큽니다.'),
  /** 요율 계산 기준: base-salary | fixed-pay | gross | deduction:<id> */
  base: z.string().refine(
    (value) => (DEDUCTION_BASES as readonly string[]).includes(value) || /^deduction:.+$/.test(value),
    '공제 계산 기준이 올바르지 않습니다.',
  ),
})

export const payProfileSchema = z.object({
  id,
  /** 이 월부터 다음 프로필 전까지 적용 */
  effectiveFrom: monthString,
  baseSalary: won,
  items: z.array(payItemSchema),
  deductions: z.array(deductionSchema),
})

const shiftSchema = z.object({ start: timeString, end: timeString, breakMinutes: minutes })
const travelRateSchema = z.object({ under: won.nullable(), over: won.nullable(), dailyCap: won })

// ---------- 설정 ----------
export const REGULATIONS = ['public-servant', 'labor-standards'] as const

export const leaveGrantSchema = z.object({
  /** 직접 입력한 부여 일수. null이면 자동 참고값 사용 */
  days: z.number().min(0).max(366).nullable(),
  /** 회사 추가 부여 일수 */
  extraDays: z.number().min(0).max(366),
  note,
})

export const settingsSchema = z.object({
  currency: z.literal('KRW'),
  defaultView: z.enum(['dayGridMonth', 'timeGridWeek']),
  weekStartsOn: z.number().int().min(0).max(6),
  regulation: z.enum(REGULATIONS),
  leave: z.object({
    basis: z.enum(['fiscal-year', 'hire-date']),
    hireDate: dateString.nullable(),
    minutesPerDay: z.number().int().min(60).max(MINUTES_PER_DAY),
    /** 외출·조퇴를 연차에서 차감 (누계 1일분 = 연차 1일). 이전 데이터에 없으면 차감으로 본다 */
    outingDeducts: z.boolean().default(true),
    officialDeducts: z.boolean(),
    sickDeducts: z.boolean(),
    /** 공무원 재직기간별 연가일수표 */
    publicServantTable: z.array(z.object({ minMonths: z.number().int().min(0), days: z.number().min(0).max(366) })).min(1),
    /** key: 회계연도 YYYY 또는 입사일 기준 기간 시작일 YYYY-MM-DD */
    grants: z.record(z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/, '부여 기간 형식이 올바르지 않습니다.'), leaveGrantSchema),
  }),
  schedule: z.object({
    regular: shiftSchema,
    weekdayDuty: shiftSchema,
    weekendDuty: shiftSchema,
    flex: z.object({ netMinutes: z.number().int().min(60).max(MINUTES_PER_DAY), breakMinutes: minutes }),
  }),
  overtime: z.object({
    hourlyRate: won,
    unitMinutes: z.number().int().min(1).max(120),
    periodStartDay: z.number().int().min(1).max(28),
    /** 월(1일~말일) 한도. 넘는 입력은 저장하지 않는다 */
    capMinutes: minutes,
    /** 주(월~일) 한도. 이전 데이터에 없으면 12시간 */
    weeklyCapMinutes: minutes.default(12 * 60),
    holidayAllowanceCountsTowardCap: z.boolean(),
  }),
  holidayWork: z.object({
    /** 8시간 근무 후 수당을 고를 때의 인정 시간 (기본 7.5시간) */
    allowanceMinutes: minutes,
  }),
  /** 대체휴무는 1회당 항상 1일(leave.minutesPerDay) 발생한다 — 발생량 설정 없음 */
  compLeave: z.object({
    validityMonths: z.number().int().min(1).max(24),
  }),
  meal: z.object({
    minOvertimeMinutes: minutes,
    /** 휴일근무 실근무가 이 시간 이상이면 매식비 발생. 이전 데이터에 없으면 4시간 */
    holidayMinWorkMinutes: minutes.default(240),
    allowCarryOver: z.boolean(),
  }),
  travel: z.object({
    thresholdMinutes: z.number().int().min(1),
    inside: travelRateSchema,
    outside: travelRateSchema,
  }),
  pay: z.object({
    payday: z.number().int().min(1).max(31),
    rounding: z.enum(['round', 'floor10']),
    profiles: z.array(payProfileSchema).min(1, '급여 설정이 1개 이상 있어야 합니다.'),
  }),
  specialLeaveTypes: z.array(z.object({ id, name: label('특별휴가명'), archived: z.boolean() })),
  session: z.object({ idleLogoutMinutes: z.number().int().min(5).max(24 * 60) }),
  /** 소득세(간이세액표) 계산 기준. 이전 데이터에 없으면 본인 1명, 자녀 0명 */
  tax: z
    .object({
      /** 공제대상 가족 수 (본인 포함, 배우자도 1명) */
      familyCount: z.number().int('공제대상 가족 수는 정수로 입력하세요.').min(1, '공제대상 가족 수는 본인 포함 1명 이상입니다.').max(30),
      /** 공제대상 가족 중 8세 이상 20세 이하 자녀 수 */
      childCount: z.number().int('자녀 수는 정수로 입력하세요.').min(0).max(20),
    })
    .refine((tax) => tax.childCount < tax.familyCount, { message: '자녀 수는 본인을 뺀 공제대상 가족 수보다 많을 수 없습니다.', path: ['childCount'] })
    .default({ familyCount: 1, childCount: 0 }),
})

// ---------- 기타 기록 ----------
export const mealUsageSchema = z.object({
  id,
  /** 매식비가 발생한 날짜 (발생 건 연결 키) */
  sourceDate: dateString,
  usedDate: dateString.nullable(),
  place: z.string().max(100, '사용처는 100자 이하로 입력하세요.'),
  used: z.boolean(),
  note,
})

export const payrollRecordSchema = z.object({ actualDeposit: won.nullable(), note })

export const customHolidaySchema = z.object({ id, date: dateString, name: label('휴일 이름') })

/** 앱에 포함된 법정공휴일의 이름을 사용자가 바꾼 기록. (date, originalName)으로 원래 휴일을 찾는다 */
export const holidayOverrideSchema = z.object({ date: dateString, originalName: z.string().min(1), name: label('휴일 이름') })

/** 사용자가 직접 삭제(소멸 처리)한 대체휴무 발생 건. 발생 일정은 그대로 둔다 */
export const compDismissalSchema = z.object({ entryId: id, date: dateString })

/**
 * 날짜별 할 일. 배열 순서가 화면 순서다.
 * 완료하지 않은 할 일은 완료할 때까지 이후 날짜에도 보인다. 날짜가 없던 이전 데이터는 처음 읽은 날짜로 둔다.
 */
export const todoSchema = z.object({
  id,
  text: z.string().max(500, '할 일은 500자 이하로 입력하세요.'),
  done: z.boolean(),
  /** 할 일을 적은 날짜 */
  date: dateString.default(() => toDateString(new Date())),
  /** 완료 체크한 날짜. 이 날까지 목록에 보인다 */
  doneOn: dateString.nullable().default(null),
})

// ---------- 전체 문서 ----------
export const appDataSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    settings: settingsSchema,
    workTypes: z.array(workTypeSchema),
    entries: z.array(entrySchema),
    mealUsages: z.array(mealUsageSchema),
    payrollRecords: z.record(monthString, payrollRecordSchema),
    holidays: z.object({ custom: z.array(customHolidaySchema), overrides: z.array(holidayOverrideSchema).default([]) }),
    /** 날짜별 메모 (일정과 별개) */
    dayNotes: z.record(dateString, z.string().max(500, '메모는 500자 이하로 입력하세요.')).default({}),
    compDismissals: z.array(compDismissalSchema).default([]),
    todos: z.array(todoSchema).default([]),
    /** v1에서 대응 항목이 없던 설정 원본 */
    legacy: z.record(z.string(), z.unknown()).optional(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((data, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    const unique = <T extends { id: string }>(items: T[], path: string, what: string) => {
      const seen = new Set<string>()
      items.forEach((item, index) => {
        if (seen.has(item.id)) issue([path, index, 'id'], `${what} ID가 중복됩니다: ${item.id}`)
        seen.add(item.id)
      })
      return seen
    }

    const typeIds = unique(data.workTypes, 'workTypes', '근무 유형')
    const typeById = new Map(data.workTypes.map((type) => [type.id, type]))
    const specialIds = new Set(data.settings.specialLeaveTypes.map((type) => type.id))
    unique(data.entries, 'entries', '일정')
    unique(data.mealUsages, 'mealUsages', '매식비 사용')
    unique(data.holidays.custom, 'holidays', '추가 휴일')
    unique(data.todos, 'todos', '할 일')
    const overridden = new Set<string>()
    data.holidays.overrides.forEach((item, index) => {
      const key = `${item.date}|${item.originalName}`
      if (overridden.has(key)) issue(['holidays', 'overrides', index], `같은 공휴일 이름 수정이 중복됩니다: ${item.date} ${item.originalName}`)
      overridden.add(key)
    })
    const dismissed = new Set<string>()
    data.compDismissals.forEach((item, index) => {
      if (dismissed.has(item.entryId)) issue(['compDismissals', index, 'entryId'], `같은 대체휴무 발생 건을 두 번 삭제했습니다: ${item.entryId}`)
      dismissed.add(item.entryId)
    })

    const unit = data.settings.overtime.unitMinutes
    const halfDay = data.settings.leave.minutesPerDay / 2
    data.entries.forEach((entry, index) => {
      if (entry.kind === 'work') {
        const type = typeById.get(entry.workTypeId)
        if (!typeIds.has(entry.workTypeId)) {
          issue(['entries', index, 'workTypeId'], `존재하지 않는 근무 유형을 참조합니다: ${entry.workTypeId}`)
          return
        }
        const isHolidayWork = type?.category === 'holiday-work'
        if (isHolidayWork && entry.holidayCompensation === null) {
          issue(['entries', index, 'holidayCompensation'], '휴일근무는 보상 방식(수당 지급/대체휴무/출장)을 선택하세요.')
        }
        if (!isHolidayWork && entry.holidayCompensation !== null) {
          issue(['entries', index, 'holidayCompensation'], '보상 방식은 휴일근무에만 선택할 수 있습니다.')
        }
        entry.overtime.forEach((segment, segmentIndex) => {
          if (!isValidTimeString(segment.startTime) || !isValidTimeString(segment.endTime)) return
          const [start, end] = segmentRange(segment)
          if ((end - start) % unit !== 0) {
            issue(['entries', index, 'overtime', segmentIndex], `연장근무는 ${unit}분 단위로 입력하세요.`)
          }
        })
      }
      if (entry.kind === 'leave') {
        if ((entry.leaveType === 'half-am' || entry.leaveType === 'half-pm') && entry.minutes !== halfDay) {
          issue(['entries', index, 'minutes'], `반차는 ${halfDay / 60}시간으로 계산합니다.`)
        }
        if (entry.compSourceId !== null) {
          const source = data.entries.find((item) => item.id === entry.compSourceId)
          const sourceCategory = source?.kind === 'work' ? typeById.get(source.workTypeId)?.category : undefined
          const earnsComp =
            sourceCategory === 'weekend-duty' ||
            (sourceCategory === 'holiday-work' && source?.kind === 'work' && (source.holidayCompensation === 'comp-leave' || source.holidayCompensation === 'trip-comp'))
          if (entry.leaveType !== 'comp' || !earnsComp) {
            issue(['entries', index, 'compSourceId'], '선택한 대체휴무 발생 건이 없습니다. 다시 선택하세요.')
          }
        }
        if (entry.specialTypeId !== null && !specialIds.has(entry.specialTypeId)) {
          issue(['entries', index, 'specialTypeId'], `존재하지 않는 특별휴가 유형입니다: ${entry.specialTypeId}`)
        }
      }
    })

    const usageSources = new Set<string>()
    data.mealUsages.forEach((usage, index) => {
      if (usageSources.has(usage.sourceDate)) {
        issue(['mealUsages', index, 'sourceDate'], `같은 발생일(${usage.sourceDate})의 매식비 사용 내역이 이미 있습니다.`)
      }
      usageSources.add(usage.sourceDate)
      if (usage.used && usage.usedDate === null) issue(['mealUsages', index, 'usedDate'], '사용 완료한 매식비는 사용일을 입력하세요.')
    })

    const months = new Set<string>()
    data.settings.pay.profiles.forEach((profile, index) => {
      if (months.has(profile.effectiveFrom)) {
        issue(['settings', 'pay', 'profiles', index, 'effectiveFrom'], `같은 적용 시작 월의 급여 설정이 있습니다: ${profile.effectiveFrom}`)
      }
      months.add(profile.effectiveFrom)
      const deductionIds = new Set(profile.deductions.map((item) => item.id))
      const referenced = new Map(
        profile.deductions.map((item) => [item.id, item.base.startsWith('deduction:') ? item.base.slice('deduction:'.length) : null]),
      )
      profile.deductions.forEach((deduction, deductionIndex) => {
        const target = referenced.get(deduction.id)
        if (target === null || target === undefined) return
        const path = ['settings', 'pay', 'profiles', index, 'deductions', deductionIndex, 'base']
        if (!deductionIds.has(target)) {
          issue(path, `"${deduction.name}"의 계산 기준 공제 항목이 없습니다.`)
          return
        }
        // 순환 참조 (A → B → A) 방지
        const visited = new Set<string>([deduction.id])
        let next: string | null | undefined = target
        while (next) {
          if (visited.has(next)) {
            issue(path, `"${deduction.name}"의 계산 기준이 순환합니다.`)
            break
          }
          visited.add(next)
          next = referenced.get(next)
        }
      })
    })
  })

export type WorkCategory = (typeof WORK_CATEGORIES)[number]
export type WorkType = z.infer<typeof workTypeSchema>
export type OvertimeSegment = z.infer<typeof overtimeSegmentSchema>
export type LeaveType = (typeof LEAVE_TYPES)[number]
export type WorkEntry = z.infer<typeof workEntrySchema>
export type LeaveEntry = z.infer<typeof leaveEntrySchema>
export type TripEntry = z.infer<typeof tripEntrySchema>
export type Entry = z.infer<typeof entrySchema>
export type PayItem = z.infer<typeof payItemSchema>
export type Deduction = z.infer<typeof deductionSchema>
export type PayProfile = z.infer<typeof payProfileSchema>
export type Regulation = (typeof REGULATIONS)[number]
export type LeaveGrant = z.infer<typeof leaveGrantSchema>
export type Settings = z.infer<typeof settingsSchema>
export type MealUsage = z.infer<typeof mealUsageSchema>
export type PayrollRecord = z.infer<typeof payrollRecordSchema>
export type CustomHoliday = z.infer<typeof customHolidaySchema>
export type HolidayOverride = z.infer<typeof holidayOverrideSchema>
export type CompDismissal = z.infer<typeof compDismissalSchema>
export type Todo = z.infer<typeof todoSchema>
export type HolidayCompensation = (typeof HOLIDAY_COMPENSATIONS)[number]
export type AppData = z.infer<typeof appDataSchema>

/** Zod 오류를 사용자에게 보여줄 문장 목록으로 바꾼다. */
export function formatSchemaIssues(error: z.ZodError, limit = 5): string[] {
  const messages = error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  return messages.length > limit ? [...messages.slice(0, limit), `외 ${messages.length - limit}건`] : messages
}
