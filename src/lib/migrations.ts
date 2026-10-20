import { format } from 'date-fns'
import { createDefaultSettings, DEFAULT_WORK_TYPES } from './defaults'
import { countCalendarDays } from './date'
import type { AppData, Entry, WorkType } from './schema'
import { appDataSchemaV1, type AppDataV1 } from './schemaV1'
import { formatSchemaIssues } from './schema'

export class MigrationError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('\n'))
    this.errors = errors
  }
}

const MINUTES_PER_DAY_V1 = 480

/** v1(로컬 저장 버전) → v2. 매핑 표는 DATABASE.md "마이그레이션 v1 → v2" 참고 */
export function migrateV1ToV2(raw: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const parsed = appDataSchemaV1.safeParse(raw)
  if (!parsed.success) throw new MigrationError(['v1 데이터 검증 실패', ...formatSchemaIssues(parsed.error)])
  const v1: AppDataV1 = parsed.data

  // 근무 유형: v1 유형은 모두 유지하고, v2 기본 유형 중 없는 것을 추가한다
  const workTypes: WorkType[] = v1.workTypes.map((type) => ({
    ...type,
    category: type.id === 'work' ? 'regular' : type.id === 'off' ? 'off' : 'custom',
  }))
  for (const type of DEFAULT_WORK_TYPES) {
    if (!workTypes.some((existing) => existing.id === type.id)) workTypes.push({ ...type })
  }

  const entries: Entry[] = v1.entries.map((entry) => {
    if (entry.kind === 'work') return { ...entry, overtime: [], holidayCompensation: null, compExpiresOn: null }
    const days = entry.leaveUnits > 0 ? entry.leaveUnits : countCalendarDays(entry.date, entry.endDate)
    const base = { id: entry.id, kind: 'leave' as const, date: entry.date, endDate: entry.endDate, startTime: null, endTime: null, compSourceId: null, note: entry.note }
    switch (entry.leaveType) {
      case 'half-am':
      case 'half-pm':
        return { ...base, leaveType: entry.leaveType, minutes: MINUTES_PER_DAY_V1 / 2, specialTypeId: null }
      case 'other':
        return { ...base, leaveType: 'special', minutes: Math.round(days * MINUTES_PER_DAY_V1), specialTypeId: 'other' }
      default:
        return { ...base, leaveType: entry.leaveType, minutes: Math.round(days * MINUTES_PER_DAY_V1), specialTypeId: null }
    }
  })

  const settings = createDefaultSettings(now)
  settings.defaultView = v1.settings.defaultView
  settings.weekStartsOn = v1.settings.weekStartsOn
  settings.leave.grants = Object.fromEntries(
    Object.entries(v1.settings.annualLeaveByYear).map(([year, grant]) => [year, { days: grant.grantedDays, extraDays: 0, note: '' }]),
  )

  const pay = v1.settings.pay
  const profile = settings.pay.profiles[0]
  profile.effectiveFrom = format(now, 'yyyy-MM')
  profile.baseSalary = pay.monthlySalary
  if (pay.fixedAllowances > 0) profile.items.push({ id: 'legacy-fixed', name: '고정수당', amount: pay.fixedAllowances, taxFree: false })
  if (pay.estimatedDeductions > 0) {
    profile.deductions.push({ id: 'legacy-deduction', name: '기타 공제', method: 'amount', value: pay.estimatedDeductions, base: 'base-salary' })
  }

  const migrated: Omit<AppData, 'schemaVersion'> = {
    settings,
    workTypes,
    entries,
    mealUsages: [],
    payrollRecords: {},
    holidays: { custom: [], overrides: [] },
    dayNotes: {},
    compDismissals: [],
    todos: [],
    // v2에 대응 항목이 없는 v1 설정은 버리지 않고 원본 그대로 보존한다
    legacy: {
      v1Pay: pay,
      v1AnnualLeaveUnitPolicy: Object.fromEntries(
        Object.entries(v1.settings.annualLeaveByYear).map(([year, grant]) => [year, grant.unitPolicy]),
      ),
    },
    updatedAt: v1.updatedAt,
  }
  return migrated
}
