import { describe, expect, it } from 'vitest'
import { appDataSchema } from '../../lib/schema'
import { leaveEntry, sampleData, workEntry } from '../../test/fixtures'
import { cleanupYears, recordYears, summarizeCleanup } from './cleanupService'

const todo = (id: string, date: string, done = false) => ({ id, text: id, done, date, doneOn: done ? date : null })

function data() {
  return sampleData({
    entries: [
      workEntry({ id: 'w2024', date: '2024-03-04', endDate: '2024-03-04' }),
      workEntry({ id: 'duty2025', workTypeId: 'weekend-duty', date: '2025-12-27', endDate: '2025-12-27' }),
      leaveEntry({ id: 'comp2026', leaveType: 'comp', date: '2026-01-05', endDate: '2026-01-05', compSourceId: 'duty2025' }),
      workEntry({ id: 'w2026', date: '2026-10-19', endDate: '2026-10-19' }),
    ],
    todos: [todo('t2024', '2024-05-01', true), todo('t2025', '2025-02-01'), todo('t2026', '2026-10-01')],
    dayNotes: { '2024-01-02': '메모', '2026-10-01': '메모' },
    payrollRecords: { '2024-12': { actualDeposit: 1, note: '' }, '2026-09': { actualDeposit: 2, note: '' } },
    compDismissals: [{ entryId: 'duty2025', date: '2026-02-01' }],
  })
}

describe('기간별 정리', () => {
  it('기록이 있는 연도를 모은다', () => {
    expect(recordYears(data())).toEqual([2024, 2025, 2026])
  })

  it('범위 안의 일정·할 일·메모·급여 기록을 지우고 설정은 남긴다', () => {
    const before = data()
    const next = cleanupYears(before, 2024, 2025)
    expect(next.entries.map((entry) => entry.id)).toEqual(['comp2026', 'w2026'])
    expect(next.todos.map((item) => item.id)).toEqual(['t2026'])
    expect(next.dayNotes).toEqual({ '2026-10-01': '메모' })
    expect(next.payrollRecords).toEqual({ '2026-09': { actualDeposit: 2, note: '' } })
    expect(next.settings).toBe(before.settings)
    expect(next.workTypes).toBe(before.workTypes)
  })

  it('지운 발생 건을 가리키던 대체휴무 사용·삭제 기록을 정리해 데이터가 계속 유효하다', () => {
    const next = cleanupYears(data(), 2025, 2025)
    expect(next.entries.find((entry) => entry.id === 'comp2026')).toMatchObject({ compSourceId: null })
    expect(next.compDismissals).toEqual([])
    expect(appDataSchema.safeParse(next).success).toBe(true)
  })

  it('지울 건수를 알려준다 (미완료 할 일 따로)', () => {
    expect(summarizeCleanup(data(), 2024, 2025)).toEqual({ entries: 2, todos: 2, openTodos: 1, dayNotes: 1, mealUsages: 0, payrollRecords: 1, customHolidays: 0, total: 6 })
    expect(summarizeCleanup(data(), 2030, 2031).total).toBe(0)
  })
})
