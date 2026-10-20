import { describe, expect, it } from 'vitest'
import { leaveEntry, sampleData, workEntry } from '../test/fixtures'
import { merge3, mergeAppData } from './merge'

const todo = (id: string, text = id, done = false) => ({ id, text, done, date: '2026-10-20', doneOn: null })

describe('3-way 병합', () => {
  it('한쪽만 바꾼 값은 바꾼 쪽, 양쪽이 같은 값을 다르게 바꾸면 이 기기(local)', () => {
    expect(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 })).toEqual({ a: 2, b: 3 })
    expect(merge3({ a: 1 }, { a: 2 }, { a: 3 })).toEqual({ a: 2 })
  })

  it('키 삭제: 다른 쪽이 그대로면 지우고, 고쳤으면 남긴다', () => {
    expect(merge3({ x: '메모', y: 'a' }, { y: 'a' }, { x: '메모', y: 'b' })).toEqual({ y: 'b' })
    expect(merge3({ x: '메모' }, {}, { x: '고친 메모' })).toEqual({ x: '고친 메모' })
  })

  it('id 배열: 양쪽 추가를 모두 남기고, 항목 안의 필드도 합친다', () => {
    const base = [todo('a'), todo('b')]
    const local = [todo('a', 'a', true), todo('b'), todo('c')]
    const remote = [todo('a', 'A'), todo('b'), todo('d')]
    expect(merge3(base, local, remote)).toEqual([todo('a', 'A', true), todo('b'), todo('d'), todo('c')])
  })

  it('id 배열: 순서를 바꾼 쪽의 순서를 쓰고, 지운 항목은 지운다', () => {
    const base = [todo('a'), todo('b'), todo('c')]
    expect(merge3(base, [todo('c'), todo('a'), todo('b')], [todo('a'), todo('b')])).toEqual([todo('a'), todo('b')])
    expect(merge3(base, [todo('a'), todo('b'), todo('c')], [todo('b'), todo('a'), todo('c'), todo('d')])).toEqual([todo('b'), todo('a'), todo('c'), todo('d')])
  })
})

describe('문서 병합', () => {
  it('다른 기기의 일정 추가와 이 기기의 할 일 추가를 모두 남긴다', () => {
    const base = sampleData()
    const local = { ...base, todos: [todo('t1', '보고서')] }
    const remote = { ...base, entries: [...base.entries, workEntry({ id: 'w2', date: '2026-10-21', endDate: '2026-10-21' })] }
    const merged = mergeAppData(base, local, remote)
    expect(merged.todos).toEqual([todo('t1', '보고서')])
    expect(merged.entries.map((entry) => entry.id)).toEqual(['w1', 'l1', 'w2'])
  })

  it('이 기기에 변경이 없으면 Drive 데이터를 그대로(같은 객체로) 쓴다', () => {
    const base = sampleData()
    const remote = sampleData({ entries: [leaveEntry()] })
    expect(mergeAppData(base, base, remote)).toBe(remote)
  })

  it('병합 결과가 검증에 실패하면 이 기기 데이터를 쓴다', () => {
    const base = sampleData()
    // 다른 기기는 근무 유형을 지우고, 이 기기는 그 유형으로 일정을 추가
    const remote = { ...base, workTypes: base.workTypes.filter((type) => type.id !== 'flex') }
    const local = { ...base, entries: [...base.entries, workEntry({ id: 'w9', workTypeId: 'flex' })] }
    expect(mergeAppData(base, local, remote)).toBe(local)
  })
})
