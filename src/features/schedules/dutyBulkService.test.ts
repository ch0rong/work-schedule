import { describe, expect, it } from 'vitest'
import { sampleData, workEntry } from '../../test/fixtures'
import { compGrants } from '../leave/compLeaveService'
import { bulkAddWork, describeWorkBulkResult, type WorkBulkInput, type WorkBulkResult } from './dutyBulkService'

let seq = 0
const createId = () => `bulk-${++seq}`
const weekday = (dates: string[], overrides: Partial<WorkBulkInput> = {}): WorkBulkInput => ({
  workTypeId: 'weekday-duty',
  dates,
  startTime: '12:30',
  endTime: '21:30',
  breakMinutes: 60,
  note: '',
  ...overrides,
})

describe('bulkAddWork', () => {
  it('선택한 날짜마다 같은 시간으로 당직을 만든다 (날짜순, 중복 날짜는 한 번)', () => {
    const data = sampleData({ entries: [] })
    const result = bulkAddWork(data, weekday(['2026-10-07', '2026-10-05', '2026-10-05']), createId)
    expect(result.added).toEqual(['2026-10-05', '2026-10-07'])
    expect(result.data.entries).toHaveLength(2)
    expect(result.data.entries[0]).toMatchObject({ kind: 'work', workTypeId: 'weekday-duty', date: '2026-10-05', startTime: '12:30', endTime: '21:30', breakMinutes: 60, overtime: [] })
    expect(data.entries).toHaveLength(0) // 원본은 바꾸지 않는다
  })

  it('이미 근무·당직이 있는 날은 건너뛰고 나머지만 등록한다', () => {
    const data = sampleData({ entries: [workEntry({ id: 'w', date: '2026-10-06', endDate: '2026-10-06' })] })
    const result = bulkAddWork(data, weekday(['2026-10-05', '2026-10-06']), createId)
    expect(result).toMatchObject({ added: ['2026-10-05'], skippedExisting: ['2026-10-06'] })
    expect(result.data.entries).toHaveLength(2)
  })

  it('자정을 넘기면 다음 날 종료로 만든다', () => {
    const result = bulkAddWork(sampleData({ entries: [] }), weekday(['2026-10-05'], { startTime: '18:00', endTime: '02:00', breakMinutes: 0 }), createId)
    expect(result.data.entries[0]).toMatchObject({ endsNextDay: true, endDate: '2026-10-06' })
  })

  it('주말 당직은 단건 등록과 같이 대체휴무 1일과 만료일이 생긴다', () => {
    const result = bulkAddWork(
      sampleData({ entries: [] }),
      { workTypeId: 'weekend-duty', dates: ['2026-10-10', '2026-10-11'], startTime: '09:00', endTime: '18:00', breakMinutes: 60, note: '' },
      createId,
    )
    expect(result.data.entries.map((entry) => entry.kind === 'work' && entry.compExpiresOn)).toEqual(['2026-11-10', '2026-11-11'])
    expect(compGrants(result.data).map((grant) => grant.minutes)).toEqual([480, 480])
  })

  it('시간이 잘못되면 아무것도 등록하지 않는다', () => {
    const data = sampleData({ entries: [] })
    const result = bulkAddWork(data, weekday(['2026-10-05', '2026-10-06'], { breakMinutes: 600 }), createId)
    expect(result.added).toEqual([])
    expect(result.data).toBe(data)
    expect(result.errors[0]).toContain('휴게시간')
  })

  it('정규 근무도 같은 방식으로 등록한다', () => {
    const result = bulkAddWork(sampleData({ entries: [] }), weekday(['2026-10-06', '2026-10-07'], { workTypeId: 'work', startTime: '09:00', endTime: '18:00' }), createId)
    expect(result).toMatchObject({ typeName: '정규 근무', added: ['2026-10-06', '2026-10-07'] })
    expect(describeWorkBulkResult(result)).toBe('정규 근무 2일을 등록했습니다.')
  })

  it('일괄 등록 대상이 아닌 유형(휴무·휴일근무 등)이나 빈 날짜는 오류', () => {
    expect(bulkAddWork(sampleData(), weekday(['2026-10-05'], { workTypeId: 'off' }), createId).errors).toEqual(['근무 종류(정규 근무·평일 당직·주말 당직)를 선택하세요.'])
    expect(bulkAddWork(sampleData(), weekday(['2026-10-05'], { workTypeId: 'holiday-work' }), createId).errors).toHaveLength(1)
    expect(bulkAddWork(sampleData(), weekday([]), createId).errors).toEqual(['등록할 날짜를 하나 이상 선택하세요.'])
  })
})

describe('describeWorkBulkResult', () => {
  const base: WorkBulkResult = { data: sampleData(), typeName: '평일 당직', added: [], skippedExisting: [], blockedByLimit: [], errors: [] }

  it('등록·건너뜀·한도 차단을 한 문장으로 안내한다', () => {
    const message = describeWorkBulkResult({
      ...base,
      added: ['2026-10-05', '2026-10-06'],
      skippedExisting: ['2026-10-07'],
      blockedByLimit: [
        { date: '2026-10-08', reasons: ['주 한도(2026-10-05 ~ 2026-10-11) …'] },
        { date: '2026-10-30', reasons: ['월 한도(2026-10-01 ~ 2026-10-31) …'] },
      ],
    })
    expect(message).toBe('평일 당직 2일을 등록했습니다. 7일은 이미 근무가 있어 건너뛰었습니다. 8일, 30일은 주/월 초과근무 한도를 넘어 등록되지 않았습니다.')
  })

  it('한 종류 한도만 넘으면 그 한도만 표시', () => {
    expect(describeWorkBulkResult({ ...base, blockedByLimit: [{ date: '2026-10-08', reasons: ['월 한도 …'] }] })).toContain('8일은 월 초과근무 한도를')
  })
})
