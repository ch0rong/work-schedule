import { describe, expect, it } from 'vitest'
import { parseBackup } from './backup'
import { appDataSchema } from './schema'
import { loadData, STORAGE_KEY, validateAppData } from './storage'
import { memoryStorage } from '../test/fixtures'

/** v1(로컬 버전)에서 내보낸 형태의 데이터 */
function v1Data() {
  return {
    schemaVersion: 1,
    settings: {
      currency: 'KRW',
      defaultView: 'timeGridWeek',
      weekStartsOn: 1,
      pay: {
        mode: 'monthly',
        hourlyRate: 12000,
        monthlySalary: 2_500_000,
        monthlyStandardMinutes: 12540,
        fixedAllowances: 100_000,
        estimatedDeductions: 50_000,
        rules: [{ id: 'r1', name: '야간', enabled: true, method: 'multiplier', rate: 0.5, appliesTo: { workTypeIds: [], timeRange: null } }],
      },
      annualLeaveByYear: { '2026': { grantedDays: 15, unitPolicy: 'half-day' } },
    },
    workTypes: [
      { id: 'work', name: '기본근무', color: '#4776E6', countsAsWork: true, archived: false },
      { id: 'remote', name: '재택근무', color: '#8257D8', countsAsWork: true, archived: false },
      { id: 'off', name: '휴무', color: '#8A8F98', countsAsWork: false, archived: false },
    ],
    entries: [
      { id: 'w', kind: 'work', date: '2026-10-19', endDate: '2026-10-19', workTypeId: 'remote', startTime: '09:00', endTime: '18:00', endsNextDay: false, breakMinutes: 60, note: '재택' },
      { id: 'a', kind: 'leave', leaveType: 'annual', date: '2026-10-23', endDate: '2026-10-27', leaveUnits: 3, note: '' },
      { id: 'h', kind: 'leave', leaveType: 'half-pm', date: '2026-10-28', endDate: '2026-10-28', leaveUnits: 0.5, note: '' },
      { id: 'o', kind: 'leave', leaveType: 'other', date: '2026-11-02', endDate: '2026-11-02', leaveUnits: 1, note: '경조사' },
      { id: 's', kind: 'leave', leaveType: 'sick', date: '2026-11-07', endDate: '2026-11-08', leaveUnits: 0, note: '' },
    ],
    updatedAt: '2026-10-18T12:00:00.000Z',
  }
}

describe('v1 → v2 마이그레이션', () => {
  it('일정·근무 유형·설정을 유지하며 v2 스키마를 통과한다', () => {
    const result = validateAppData(v1Data())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = result.data
    expect(appDataSchema.safeParse(data).success).toBe(true)
    expect(data.schemaVersion).toBe(2)
    expect(data.settings.defaultView).toBe('timeGridWeek')

    // 근무 유형: v1 유지 + v2 기본 유형 추가
    expect(data.workTypes.find((type) => type.id === 'remote')?.category).toBe('custom')
    expect(data.workTypes.find((type) => type.id === 'work')?.category).toBe('regular')
    expect(data.workTypes.some((type) => type.category === 'weekend-duty')).toBe(true)

    // 일정
    const byId = new Map(data.entries.map((entry) => [entry.id, entry]))
    expect(byId.get('w')).toMatchObject({ kind: 'work', workTypeId: 'remote', note: '재택', overtime: [], holidayCompensation: null })
    expect(byId.get('a')).toMatchObject({ leaveType: 'annual', minutes: 1440 })
    expect(byId.get('h')).toMatchObject({ leaveType: 'half-pm', minutes: 240 })
    expect(byId.get('o')).toMatchObject({ leaveType: 'special', specialTypeId: 'other', minutes: 480, note: '경조사' })
    expect(byId.get('s')).toMatchObject({ leaveType: 'sick', minutes: 960 }) // 0일 → 달력 일수

    // 연차 부여, 급여
    expect(data.settings.leave.grants['2026']).toEqual({ days: 15, extraDays: 0, note: '' })
    const profile = data.settings.pay.profiles[0]
    expect(profile.baseSalary).toBe(2_500_000)
    expect(profile.items.find((item) => item.name === '고정수당')?.amount).toBe(100_000)
    expect(profile.deductions.find((item) => item.name === '기타 공제')?.value).toBe(50_000)

    // v2에 대응 항목이 없는 v1 급여 설정은 보존
    expect(data.legacy?.v1Pay).toMatchObject({ mode: 'monthly', hourlyRate: 12000, rules: [expect.objectContaining({ name: '야간' })] })
  })

  it('v1 백업 파일도 가져올 수 있다', () => {
    const text = JSON.stringify({ format: 'work-schedule-backup', exportedAt: '2026-10-18T12:00:00.000Z', data: v1Data() })
    const result = parseBackup(text)
    expect(result.ok).toBe(true)
  })

  it('잘못된 v1 데이터는 변환하지 않고 오류를 돌려준다', () => {
    const broken = { ...v1Data(), entries: [{ id: 'x', kind: 'work' }] }
    const result = validateAppData(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('v1 데이터 검증 실패')
  })

  it('localStorage의 v1 원본은 변환 전에 별도 키에 보관된다', () => {
    const raw = JSON.stringify(v1Data())
    const storage = memoryStorage({ [STORAGE_KEY]: raw })
    expect(loadData(storage).status).toBe('loaded')
    expect(storage.items.get(`${STORAGE_KEY}:backup-v1`)).toBe(raw)
  })
})
