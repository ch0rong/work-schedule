import { describe, expect, it } from 'vitest'
import { leaveEntry, sampleData, workEntry } from '../../test/fixtures'
import { appDataSchema, type AppData } from '../../lib/schema'
import { removeEntry, upsertEntry } from '../schedules/scheduleService'
import { compGrants, dismissCompGrant, getCompUseWarnings, summarizeCompLeave } from './compLeaveService'

const weekendDuty = (id: string, date: string) => workEntry({ id, workTypeId: 'weekend-duty', date, endDate: date })
const holidayTrip = (id: string, date: string) => workEntry({ id, workTypeId: 'holiday-work', date, endDate: date, holidayCompensation: 'trip-comp' })
const compUse = (id: string, date: string, minutes: number) => leaveEntry({ id, leaveType: 'comp', date, endDate: date, minutes })

describe('대체휴무 발생', () => {
  it('주말 당직은 항상 1일, 휴일근무는 대체휴무·출장 선택 시에만 1일', () => {
    const data = sampleData({
      entries: [
        weekendDuty('a', '2026-10-03'),
        workEntry({ id: 'b', workTypeId: 'holiday-work', date: '2026-10-09', endDate: '2026-10-09', holidayCompensation: 'comp-leave' }),
        workEntry({ id: 'c', workTypeId: 'holiday-work', date: '2026-10-10', endDate: '2026-10-10', holidayCompensation: 'allowance' }),
        holidayTrip('d', '2026-10-11'),
      ],
    })
    expect(compGrants(data).map((grant) => [grant.date, grant.reason, grant.minutes])).toEqual([
      ['2026-10-03', '주말 당직', 480],
      ['2026-10-09', '휴일근무', 480],
      ['2026-10-11', '휴일 출장', 480],
    ])
  })

  it('발생량은 항상 1일 — 예전 발생량 설정이 남아 있어도 무시한다', () => {
    const raw = JSON.parse(JSON.stringify(sampleData({ entries: [weekendDuty('a', '2026-10-03')] }))) as AppData
    Object.assign(raw.settings.compLeave, { weekendDutyMinutes: 240 })
    const data = appDataSchema.parse(raw)
    expect(data.settings.compLeave).toEqual({ validityMonths: 1 })
    expect(compGrants(data)[0].minutes).toBe(480)
  })

  it('사용 기한은 발생일 + 1개월', () => {
    const [grant] = compGrants(sampleData({ entries: [weekendDuty('a', '2026-01-31')] }))
    expect(grant.lastUsableDate).toBe('2026-02-28')
  })
})

describe('만료일 기록', () => {
  it('저장할 때 대체휴무가 발생하는 근무에 만료일을 기록하고, 아니면 null', () => {
    let data = sampleData({ entries: [] })
    data = upsertEntry(data, holidayTrip('t', '2026-10-11'))
    data = upsertEntry(data, workEntry({ id: 'w', date: '2026-10-12', endDate: '2026-10-12' }))
    expect(data.entries.find((entry) => entry.id === 't')).toMatchObject({ compExpiresOn: '2026-11-11' })
    expect(data.entries.find((entry) => entry.id === 'w')).toMatchObject({ compExpiresOn: null })
  })

  it('기한 설정을 바꿔도 이미 기록된 만료일은 유지하고, 날짜를 바꾸면 다시 계산한다', () => {
    let data = upsertEntry(sampleData({ entries: [] }), holidayTrip('t', '2026-10-11'))
    data = { ...data, settings: { ...data.settings, compLeave: { ...data.settings.compLeave, validityMonths: 3 } } }
    data = upsertEntry(data, { ...holidayTrip('t', '2026-10-11'), note: '메모' })
    expect(compGrants(data)[0].lastUsableDate).toBe('2026-11-11')
    data = upsertEntry(data, holidayTrip('t', '2026-10-18'))
    expect(compGrants(data)[0].lastUsableDate).toBe('2027-01-18')
  })

  it('보상을 수당으로 바꾸면 만료일을 지운다', () => {
    let data = upsertEntry(sampleData({ entries: [] }), holidayTrip('t', '2026-10-11'))
    data = upsertEntry(data, { ...holidayTrip('t', '2026-10-11'), holidayCompensation: 'allowance' })
    expect(data.entries[0]).toMatchObject({ compExpiresOn: null })
  })
})

describe('기한 지남 — 자동 소멸하지 않음', () => {
  it('9/12(토) 주말 당직: 10/12까지 사용 기한, 10/19에는 기한 지남으로 표시하되 잔여·사용 가능에 남는다', () => {
    const data = sampleData({ entries: [weekendDuty('d', '2026-09-12')] })
    expect(summarizeCompLeave(data, '2026-10-12')).toMatchObject({ availableMinutes: 480, overdueMinutes: 0 })
    const after = summarizeCompLeave(data, '2026-10-19')
    expect(after).toMatchObject({ earnedMinutes: 480, availableMinutes: 480, overdueMinutes: 480, dismissedMinutes: 0 })
    expect(after.grants[0]).toMatchObject({ lastUsableDate: '2026-10-12', status: 'overdue', remainingMinutes: 480 })
  })

  it('기한이 지난 발생분도 사용할 수 있고, 저장 전에 경고만 한다', () => {
    const data = sampleData({ entries: [weekendDuty('a', '2026-09-12')] })
    const use = { ...compUse('u', '2026-10-19', 480), compSourceId: 'a' }
    const warnings = getCompUseWarnings(data, use)
    expect(warnings).toEqual([expect.stringContaining('사용 기한이 지난 대체휴무(2026-09-12 발생분)')])
    const summary = summarizeCompLeave(sampleData({ entries: [weekendDuty('a', '2026-09-12'), use] }), '2026-10-19')
    expect(summary.uses[0]).toMatchObject({ allocations: [{ grantDate: '2026-09-12', minutes: 480, overdue: true }], unallocatedMinutes: 0 })
    expect(summary.grants[0].status).toBe('used')
  })

  it('자동 차감은 기한 안의 발생분을 먼저, 기한 지난 발생분은 마지막에 쓴다', () => {
    const data = sampleData({
      entries: [weekendDuty('old', '2026-09-05'), weekendDuty('new', '2026-10-10'), compUse('u1', '2026-10-19', 480), compUse('u2', '2026-10-20', 480)],
    })
    const summary = summarizeCompLeave(data, '2026-10-20')
    expect(summary.uses.map((use) => use.allocations)).toEqual([
      [{ grantDate: '2026-10-10', minutes: 480, overdue: false }],
      [{ grantDate: '2026-09-05', minutes: 480, overdue: true }],
    ])
  })

  it('7일 안에 기한이 되는 잔여는 임박으로 표시', () => {
    const data = sampleData({ entries: [weekendDuty('a', '2026-09-05'), weekendDuty('b', '2026-09-30')] })
    const summary = summarizeCompLeave(data, '2026-10-25')
    expect(summary.overdueMinutes).toBe(480) // 9/5 → 10/5 지남
    expect(summary.availableMinutes).toBe(960)
    expect(summary.expiringSoonMinutes).toBe(480) // 9/30 → 10/30
  })
})

describe('수동 삭제', () => {
  it('직접 삭제한 발생 건은 잔여·사용 가능에서 빠지고 근무 일정은 남는다', () => {
    const data = dismissCompGrant(sampleData({ entries: [weekendDuty('a', '2026-09-05'), compUse('u', '2026-09-10', 240)] }), 'a', '2026-10-19')
    expect(data.entries).toHaveLength(2)
    const summary = summarizeCompLeave(data, '2026-10-19')
    expect(summary.grants[0]).toMatchObject({ status: 'dismissed', dismissedOn: '2026-10-19', remainingMinutes: 240 })
    expect(summary).toMatchObject({ availableMinutes: 0, dismissedMinutes: 240, overdueMinutes: 0, usedMinutes: 240 })
  })

  it('삭제한 날 이후 사용에는 차감하지 않는다', () => {
    const data = dismissCompGrant(sampleData({ entries: [weekendDuty('a', '2026-09-05')] }), 'a', '2026-10-19')
    expect(getCompUseWarnings(data, compUse('u', '2026-10-20', 480))).toEqual([expect.stringContaining('부족')])
  })

  it('같은 건을 두 번 삭제하지 않고, 발생 일정을 지우면 삭제 기록도 정리한다', () => {
    let data = sampleData({ entries: [weekendDuty('a', '2026-09-05')] })
    data = dismissCompGrant(dismissCompGrant(data, 'a', '2026-10-19'), 'a', '2026-10-20')
    expect(data.compDismissals).toEqual([{ entryId: 'a', date: '2026-10-19' }])
    expect(removeEntry(data, 'a').compDismissals).toEqual([])
  })
})

describe('대체휴무 사용', () => {
  it('반일·시간 단위로 나눠 쓰고 잔여를 계산한다', () => {
    const data = sampleData({
      entries: [weekendDuty('a', '2026-10-03'), compUse('u1', '2026-10-06', 240), compUse('u2', '2026-10-08', 120)],
    })
    const summary = summarizeCompLeave(data, '2026-10-10')
    expect(summary).toMatchObject({ earnedMinutes: 480, usedMinutes: 360, availableMinutes: 120, overdueMinutes: 0 })
  })

  it('발생 건을 직접 고르면 그 건에서 차감하고, 자동 사용은 남은 건에서 차감한다', () => {
    const data = sampleData({
      entries: [
        weekendDuty('a', '2026-10-03'),
        weekendDuty('b', '2026-10-10'),
        { ...compUse('auto', '2026-10-12', 480) },
        { ...compUse('pick', '2026-10-14', 480), compSourceId: 'a' },
      ],
    })
    const summary = summarizeCompLeave(data, '2026-10-15')
    expect(summary.uses.find((use) => use.entry.id === 'pick')?.allocations).toEqual([{ grantDate: '2026-10-03', minutes: 480, overdue: false }])
    expect(summary.uses.find((use) => use.entry.id === 'auto')?.allocations).toEqual([{ grantDate: '2026-10-10', minutes: 480, overdue: false }])
  })

  it('기한이 빠른 발생분부터 차감한다', () => {
    const data = sampleData({
      entries: [weekendDuty('a', '2026-10-03'), weekendDuty('b', '2026-10-10'), compUse('u', '2026-10-12', 480)],
    })
    const summary = summarizeCompLeave(data, '2026-10-12')
    expect(summary.uses[0].allocations).toEqual([{ grantDate: '2026-10-03', minutes: 480, overdue: false }])
  })

  it('발생 전 사용은 부족 경고, 기한 후 사용은 기한 경고', () => {
    const data = sampleData({ entries: [weekendDuty('a', '2026-10-10')] })
    expect(getCompUseWarnings(data, compUse('u', '2026-10-05', 480))).toEqual([expect.stringContaining('부족')])
    expect(getCompUseWarnings(data, compUse('u', '2026-11-11', 480))).toEqual([expect.stringContaining('사용 기한이 지난')])
    expect(getCompUseWarnings(data, compUse('u', '2026-10-12', 480))).toEqual([])
  })
})

describe('발생 예정', () => {
  it('기준일 이후 발생분은 사용 가능 잔여에 넣지 않고 발생 예정으로 따로 알려준다', () => {
    const data = sampleData({ entries: [weekendDuty('a', '2026-10-24')] })
    const summary = summarizeCompLeave(data, '2026-10-19')
    expect(summary).toMatchObject({ availableMinutes: 0, upcoming: [{ date: '2026-10-24', minutes: 480 }] })
    expect(summarizeCompLeave(data, '2026-10-24')).toMatchObject({ availableMinutes: 480, upcoming: [] })
  })
})
