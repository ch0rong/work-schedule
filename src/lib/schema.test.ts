import { describe, expect, it } from 'vitest'
import { leaveEntry, sampleData, tripEntry, workEntry } from '../test/fixtures'
import { createDefaultData } from './defaults'
import { appDataSchema, entrySchema } from './schema'

const valid = (data: unknown) => appDataSchema.safeParse(data).success

describe('appDataSchema v2', () => {
  it('기본 데이터와 예시 데이터를 통과시킨다', () => {
    expect(valid(createDefaultData())).toBe(true)
    expect(valid(sampleData())).toBe(true)
  })

  it('주 한도·휴일 출장·만료일·대체휴무 삭제 기록이 없는 기존 데이터는 기본값으로 읽는다', () => {
    const data = JSON.parse(JSON.stringify(sampleData())) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- 기존 형식 재현
    delete data.compDismissals
    delete data.settings.overtime.weeklyCapMinutes
    delete data.entries[0].compExpiresOn
    const parsed = appDataSchema.parse(data)
    expect(parsed.compDismissals).toEqual([])
    expect(parsed.settings.overtime.weeklyCapMinutes).toBe(720)
    expect(parsed.entries[0]).toMatchObject({ compExpiresOn: null })
  })

  it('휴일근무 출장(대체휴무) 보상과 그 발생 건을 쓰는 대체휴무 사용을 허용한다', () => {
    const trip = workEntry({ id: 't', workTypeId: 'holiday-work', date: '2026-10-11', endDate: '2026-10-11', holidayCompensation: 'trip-comp' })
    expect(valid(sampleData({ entries: [trip, leaveEntry({ leaveType: 'comp', compSourceId: 't' })] }))).toBe(true)
    expect(valid(sampleData({ entries: [trip], compDismissals: [{ entryId: 't', date: '2026-10-19' }, { entryId: 't', date: '2026-10-20' }] }))).toBe(false)
  })

  it('존재하지 않는 근무 유형·특별휴가 유형 참조와 중복 ID를 거부한다', () => {
    expect(valid(sampleData({ entries: [workEntry({ workTypeId: 'missing' })] }))).toBe(false)
    expect(valid(sampleData({ entries: [leaveEntry({ leaveType: 'special', specialTypeId: 'missing' })] }))).toBe(false)
    expect(valid(sampleData({ entries: [workEntry(), workEntry()] }))).toBe(false)
  })

  it('휴일근무는 보상 방식이 필요하고, 다른 근무는 보상 방식을 가질 수 없다', () => {
    expect(valid(sampleData({ entries: [workEntry({ workTypeId: 'holiday-work' })] }))).toBe(false)
    expect(valid(sampleData({ entries: [workEntry({ workTypeId: 'holiday-work', holidayCompensation: 'allowance' })] }))).toBe(true)
    expect(valid(sampleData({ entries: [workEntry({ workTypeId: 'weekend-duty', holidayCompensation: 'allowance' })] }))).toBe(false)
  })

  it('연장근무는 30분 단위만 허용한다', () => {
    const at = (end: string) => sampleData({ entries: [workEntry({ overtime: [{ startTime: '18:00', endTime: end, endsNextDay: false }] })] })
    expect(valid(at('19:30'))).toBe(true)
    expect(valid(at('19:20'))).toBe(false)
  })

  it('반차는 4시간이어야 한다', () => {
    expect(valid(sampleData({ entries: [leaveEntry({ leaveType: 'half-am', minutes: 240 })] }))).toBe(true)
    expect(valid(sampleData({ entries: [leaveEntry({ leaveType: 'half-am', minutes: 480 })] }))).toBe(false)
  })

  it('같은 발생일의 매식비 사용 내역 중복과 사용일 없는 사용 완료를 거부한다', () => {
    const usage = { id: 'u1', sourceDate: '2026-10-05', usedDate: '2026-10-05', place: '', used: true, note: '' }
    expect(valid(sampleData({ mealUsages: [usage, { ...usage, id: 'u2' }] }))).toBe(false)
    expect(valid(sampleData({ mealUsages: [{ ...usage, usedDate: null }] }))).toBe(false)
  })

  it('공제 기준 순환 참조를 거부한다', () => {
    const data = sampleData()
    data.settings.pay.profiles[0].deductions = [
      { id: 'a', name: 'A', method: 'rate', value: 1, base: 'deduction:b' },
      { id: 'b', name: 'B', method: 'rate', value: 1, base: 'deduction:a' },
    ]
    expect(valid(data)).toBe(false)
  })
})

describe('entrySchema — 근무', () => {
  it('자정 넘김: 다음 날 종료 없이는 거부, 연말 → 다음 해 1월 1일', () => {
    expect(entrySchema.safeParse(workEntry({ startTime: '22:00', endTime: '06:00' })).success).toBe(false)
    const entry = workEntry({ date: '2026-12-31', endDate: '2027-01-01', startTime: '22:00', endTime: '06:00', endsNextDay: true })
    expect(entrySchema.safeParse(entry).success).toBe(true)
  })

  it('휴게시간이 경과시간보다 길면 거부', () => {
    expect(entrySchema.safeParse(workEntry({ breakMinutes: 541 })).success).toBe(false)
  })

  it('연장근무가 근무시간과 겹치거나 서로 겹치면 거부', () => {
    const at = (...segments: [string, string][]) =>
      entrySchema.safeParse(workEntry({ overtime: segments.map(([startTime, endTime]) => ({ startTime, endTime, endsNextDay: false })) })).success
    expect(at(['07:00', '09:00'], ['18:00', '19:00'])).toBe(true)
    expect(at(['17:30', '19:00'])).toBe(false)
    expect(at(['18:00', '19:00'], ['18:30', '20:00'])).toBe(false)
  })

  it('윤년이 아닌 해의 2월 29일을 거부', () => {
    expect(entrySchema.safeParse(workEntry({ date: '2026-02-29', endDate: '2026-02-29' })).success).toBe(false)
  })
})

describe('entrySchema — 휴가·출장', () => {
  it('외출은 하루만, 시작·종료는 둘 다 있거나 둘 다 없어야 한다', () => {
    expect(entrySchema.safeParse(leaveEntry({ leaveType: 'outing', minutes: 120, startTime: '14:00', endTime: '16:00' })).success).toBe(true)
    expect(entrySchema.safeParse(leaveEntry({ leaveType: 'outing', minutes: 120, endDate: '2026-10-24' })).success).toBe(false)
    expect(entrySchema.safeParse(leaveEntry({ startTime: '14:00' })).success).toBe(false)
  })

  it('연도를 넘기는 휴가와 0분 사용을 거부', () => {
    expect(entrySchema.safeParse(leaveEntry({ date: '2026-12-31', endDate: '2027-01-02' })).success).toBe(false)
    expect(entrySchema.safeParse(leaveEntry({ minutes: 0 })).success).toBe(false)
  })

  it('출장: 당일은 종료가 시작보다 늦어야 하고, 여러 날은 복귀일이 출발일 이후', () => {
    expect(entrySchema.safeParse(tripEntry()).success).toBe(true)
    expect(entrySchema.safeParse(tripEntry({ endTime: '12:00' })).success).toBe(false)
    expect(entrySchema.safeParse(tripEntry({ endDate: '2026-10-21', endTime: '12:00' })).success).toBe(true) // 1박 2일은 복귀 시각이 더 일러도 됨
    expect(entrySchema.safeParse(tripEntry({ endDate: '2026-10-19' })).success).toBe(false)
    expect(entrySchema.safeParse(tripEntry({ endDate: '2026-12-01' })).success).toBe(false) // 31일 초과
  })
})
