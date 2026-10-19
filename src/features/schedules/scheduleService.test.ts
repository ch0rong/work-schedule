import { describe, expect, it } from 'vitest'
import { appDataSchema } from '../../lib/schema'
import { leaveEntry, sampleData, workEntry } from '../../test/fixtures'
import {
  entriesOnDate,
  holidayWorkCompensationText,
  findLeaveWorkConflicts,
  findTimeOverlaps,
  getEntryWarnings,
  isWorkTypeInUse,
  readableTextColor,
  removeEntry,
  removeWorkType,
  upsertEntry,
  upsertWorkType,
} from './scheduleService'

describe('일정 CRUD', () => {
  it('추가·수정·삭제', () => {
    let data = sampleData({ entries: [] })
    data = upsertEntry(data, workEntry())
    expect(data.entries).toHaveLength(1)

    data = upsertEntry(data, workEntry({ note: '수정' }))
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].note).toBe('수정')

    data = removeEntry(data, 'w1')
    expect(data.entries).toHaveLength(0)
  })

  it('자정 넘김 근무는 다음 날 목록에도 나온다', () => {
    const night = workEntry({ id: 'n', startTime: '22:00', endTime: '06:00', endsNextDay: true, endDate: '2026-10-20' })
    expect(entriesOnDate([night], '2026-10-19')).toHaveLength(1)
    expect(entriesOnDate([night], '2026-10-20')).toHaveLength(1)
    expect(entriesOnDate([night], '2026-10-21')).toHaveLength(0)
  })
})

describe('대체휴무 발생 건 연결', () => {
  it('발생 건(주말 당직)을 지우면 그 건을 고른 사용은 자동 차감으로 바뀌고 데이터는 유효하다', () => {
    const duty = workEntry({ id: 'd', workTypeId: 'weekend-duty', date: '2026-10-17', endDate: '2026-10-17' })
    const use = leaveEntry({ id: 'u', leaveType: 'comp', date: '2026-10-19', endDate: '2026-10-19', compSourceId: 'd' })
    const data = removeEntry(sampleData({ entries: [duty, use] }), 'd')
    expect(data.entries).toEqual([expect.objectContaining({ id: 'u', compSourceId: null })])
    expect(appDataSchema.safeParse(data).success).toBe(true)
  })
})

describe('겹침 경고', () => {
  it('시간이 겹치는 근무를 찾는다', () => {
    const existing = workEntry({ id: 'a' })
    expect(findTimeOverlaps([existing], workEntry({ id: 'b', startTime: '17:00', endTime: '20:00', breakMinutes: 0 }))).toHaveLength(1)
    expect(findTimeOverlaps([existing], workEntry({ id: 'b', startTime: '18:00', endTime: '20:00', breakMinutes: 0 }))).toHaveLength(0)
  })

  it('자정 넘김 근무와 다음 날 아침 근무의 겹침을 찾는다', () => {
    const night = workEntry({ id: 'a', startTime: '22:00', endTime: '06:00', endsNextDay: true, endDate: '2026-10-20' })
    const morning = workEntry({ id: 'b', date: '2026-10-20', endDate: '2026-10-20', startTime: '05:00', endTime: '09:00', breakMinutes: 0 })
    expect(findTimeOverlaps([night], morning)).toHaveLength(1)
  })

  it('자기 자신과는 겹치지 않는다', () => {
    expect(findTimeOverlaps([workEntry()], workEntry())).toHaveLength(0)
  })

  it('휴가 기간과 근무가 겹치면 찾는다', () => {
    const leave = leaveEntry({ date: '2026-10-19', endDate: '2026-10-21', minutes: 1440 })
    expect(findLeaveWorkConflicts(sampleData({ entries: [leave] }), workEntry())).toHaveLength(1)
    expect(findLeaveWorkConflicts(sampleData({ entries: [workEntry()] }), leave)).toHaveLength(1)
    expect(findLeaveWorkConflicts(sampleData({ entries: [workEntry({ date: '2026-10-22', endDate: '2026-10-22' })] }), leave)).toHaveLength(0)
  })

  it('반차·외출 같은 부분 사용은 근무와 겹쳐도 경고하지 않는다', () => {
    const half = leaveEntry({ leaveType: 'half-am', date: '2026-10-19', endDate: '2026-10-19', minutes: 240 })
    expect(findLeaveWorkConflicts(sampleData({ entries: [half] }), workEntry())).toHaveLength(0)
  })

  it('12시간을 넘는 실근무를 경고한다', () => {
    const data = sampleData({ entries: [] })
    const long = workEntry({ startTime: '06:00', endTime: '22:00', breakMinutes: 60 })
    expect(getEntryWarnings(data, long)).toEqual([expect.stringContaining('매우 깁니다')])
    expect(getEntryWarnings(data, workEntry())).toEqual([])
  })
})

describe('근무 유형', () => {
  it('사용 중인 유형은 삭제할 수 없다', () => {
    const data = sampleData()
    expect(isWorkTypeInUse(data, 'work')).toBe(true)
    expect(() => removeWorkType(data, 'work')).toThrow()
    expect(removeWorkType(data, 'remote').workTypes.some((type) => type.id === 'remote')).toBe(false)
  })

  it('유형 추가 후에도 데이터가 유효하다', () => {
    const data = upsertWorkType(sampleData(), { id: 'x', name: '교육', color: '#123456', countsAsWork: true, archived: false, category: 'custom' })
    expect(appDataSchema.safeParse(data).success).toBe(true)
  })

  it('배경색에 맞는 글자색', () => {
    expect(readableTextColor('#FFFFFF')).toBe('#1f2328')
    expect(readableTextColor('#4776E6')).toBe('#ffffff')
  })
})

describe('holidayWorkCompensationText', () => {
  const holiday = (startTime: string, endTime: string, holidayCompensation: 'allowance' | 'comp-leave' | 'trip-comp') =>
    workEntry({ workTypeId: 'holiday-work', date: '2026-09-13', endDate: '2026-09-13', startTime, endTime, breakMinutes: 0, holidayCompensation })
  const data = sampleData()

  it('8시간 미만은 실근무 수당 내역', () => {
    expect(holidayWorkCompensationText(holiday('09:00', '13:00', 'allowance'), data)).toEqual({ short: '수당 72,200원', detail: '4시간 × 18,050원 · 8시간 미만 실근무' })
  })

  it('8시간 수당은 7.5시간 기준, 초과분은 미인정으로 안내', () => {
    expect(holidayWorkCompensationText(holiday('08:00', '18:00', 'allowance'), data)).toEqual({
      short: '수당 135,375원',
      detail: '7시간 30분 × 18,050원 · 8시간 근무 수당 기준 · 8시간 초과 2시간 미인정',
    })
  })

  it('대체휴무·출장은 대체휴무 1일, 수당 없음', () => {
    expect(holidayWorkCompensationText(holiday('09:00', '17:00', 'comp-leave'), data)).toEqual({ short: '대체휴무 1일', detail: '수당 없음' })
    expect(holidayWorkCompensationText(holiday('09:00', '18:00', 'trip-comp'), data)).toEqual({ short: '출장 · 대체휴무 1일', detail: '수당 없음 · 8시간 초과 1시간 미인정' })
  })

  it('휴일근무가 아니면 null', () => {
    expect(holidayWorkCompensationText(workEntry(), data)).toBeNull()
  })
})
