import { format } from 'date-fns'
import { SCHEMA_VERSION, type AppData, type PayProfile, type Settings, type WorkType } from './schema'

/** DESIGN.md 색상 원칙에 따른 기본 근무 유형. id는 v1과 호환되도록 기본근무 'work', 휴무 'off'를 유지한다. */
export const DEFAULT_WORK_TYPES: readonly WorkType[] = [
  { id: 'work', name: '기본근무', color: '#4776E6', countsAsWork: true, archived: false, category: 'regular' },
  { id: 'flex', name: '유연근무', color: '#1A9AA0', countsAsWork: true, archived: false, category: 'flex' },
  { id: 'weekday-duty', name: '평일 당직', color: '#E07B1A', countsAsWork: true, archived: false, category: 'weekday-duty' },
  { id: 'weekend-duty', name: '주말 당직', color: '#B4530F', countsAsWork: true, archived: false, category: 'weekend-duty' },
  { id: 'holiday-work', name: '휴일근무', color: '#A83279', countsAsWork: true, archived: false, category: 'holiday-work' },
  { id: 'off', name: '휴무', color: '#8A8F98', countsAsWork: false, archived: false, category: 'off' },
]

/**
 * 국가공무원 복무규정 제15조 재직기간별 연가일수 (2024년 개정 반영: 1~3년 15일, 3~4년 16일).
 * 출처: 인사혁신처 국가공무원 복무규정 개정(2024). 설정에서 수정 가능.
 */
export const PUBLIC_SERVANT_LEAVE_TABLE: Settings['leave']['publicServantTable'] = [
  { minMonths: 1, days: 11 },
  { minMonths: 12, days: 15 },
  { minMonths: 36, days: 16 },
  { minMonths: 48, days: 17 },
  { minMonths: 60, days: 20 },
  { minMonths: 72, days: 21 },
]

export const DEFAULT_SPECIAL_LEAVE_TYPES: Settings['specialLeaveTypes'] = [
  { id: 'congratulations', name: '경조사휴가', archived: false },
  { id: 'other', name: '기타 특별휴가', archived: false },
]

/**
 * 급여 설정 기본 틀. 4대보험 금액·요율은 사용자가 입력하므로 모두 0이다(법정 요율을 추정하지 않음).
 * 소득세·지방소득세는 간이세액표로 자동 계산하므로 공제 항목에 두지 않는다.
 */
export function createDefaultPayProfile(effectiveFrom: string): PayProfile {
  return {
    id: 'default',
    effectiveFrom,
    baseSalary: 0,
    items: [
      { id: 'transport', name: '교통비', amount: 0, taxFree: false },
      { id: 'meal', name: '식비', amount: 0, taxFree: false },
    ],
    deductions: [
      { id: 'pension', name: '국민연금', method: 'amount', value: 0, base: 'base-salary' },
      { id: 'health', name: '건강보험', method: 'amount', value: 0, base: 'base-salary' },
      { id: 'ltc', name: '장기요양보험', method: 'amount', value: 0, base: 'deduction:health' },
      { id: 'employment', name: '고용보험', method: 'amount', value: 0, base: 'base-salary' },
    ],
  }
}

export function createDefaultSettings(now: Date = new Date()): Settings {
  return {
    currency: 'KRW',
    defaultView: 'dayGridMonth',
    weekStartsOn: 0,
    regulation: 'public-servant',
    leave: {
      basis: 'fiscal-year',
      hireDate: null,
      minutesPerDay: 480,
      outingDeducts: true,
      officialDeducts: false,
      sickDeducts: false,
      publicServantTable: PUBLIC_SERVANT_LEAVE_TABLE.map((row) => ({ ...row })),
      grants: {},
    },
    schedule: {
      regular: { start: '09:00', end: '18:00', breakMinutes: 60 },
      weekdayDuty: { start: '12:30', end: '21:30', breakMinutes: 60 },
      weekendDuty: { start: '09:00', end: '18:00', breakMinutes: 60 },
      flex: { netMinutes: 480, breakMinutes: 60 },
    },
    overtime: {
      hourlyRate: 18050,
      unitMinutes: 30,
      periodStartDay: 21,
      capMinutes: 20 * 60,
      weeklyCapMinutes: 12 * 60,
      holidayAllowanceCountsTowardCap: false,
    },
    holidayWork: { allowanceMinutes: 450 },
    compLeave: { validityMonths: 1 },
    meal: { minOvertimeMinutes: 60, holidayMinWorkMinutes: 240, allowCarryOver: false },
    travel: {
      thresholdMinutes: 240,
      inside: { under: 10000, over: 20000, dailyCap: 20000 },
      outside: { under: null, over: 25000, dailyCap: 25000 },
    },
    pay: { payday: 25, rounding: 'round', profiles: [createDefaultPayProfile(format(now, 'yyyy-MM'))] },
    specialLeaveTypes: DEFAULT_SPECIAL_LEAVE_TYPES.map((type) => ({ ...type })),
    session: { idleLogoutMinutes: 30 },
    tax: { familyCount: 1, childCount: 0 },
  }
}

/** 처음 실행할 때 쓰는 빈 데이터 */
export function createDefaultData(now: Date = new Date()): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: createDefaultSettings(now),
    workTypes: DEFAULT_WORK_TYPES.map((type) => ({ ...type })),
    entries: [],
    mealUsages: [],
    payrollRecords: {},
    holidays: { custom: [], overrides: [] },
    dayNotes: {},
    compDismissals: [],
    updatedAt: now.toISOString(),
  }
}
