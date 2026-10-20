import { describe, expect, it } from 'vitest'
import type { Todo } from '../../lib/schema'
import { insertTodo, moveTodo, moveTodoInView, removeTodo, setTodoDone, splitTodo, todosOnDate } from './todoService'

const todo = (id: string, overrides: Partial<Todo> = {}): Todo => ({ id, text: id, done: false, date: '2026-10-20', doneOn: null, ...overrides })
const ids = (list: { id: string }[]) => list.map((item) => item.id)

describe('날짜별 할 일', () => {
  const list = [
    todo('past-open', { date: '2026-10-18' }),
    todo('past-done-before', { date: '2026-10-18', done: true, doneOn: '2026-10-19' }),
    todo('past-done-today', { date: '2026-10-18', done: true, doneOn: '2026-10-20' }),
    todo('today'),
    todo('future', { date: '2026-10-21' }),
  ]

  it('그날 적은 것 + 이전에 적고 아직 완료하지 않은 것을 보여준다', () => {
    const shown = todosOnDate(list, '2026-10-20')
    expect(shown.map((item) => [item.todo.id, item.carried, item.done])).toEqual([
      ['past-open', true, false],
      ['past-done-today', true, true],
      ['today', false, false],
    ])
  })

  it('완료한 날보다 앞선 날짜에서는 미완료로 보인다', () => {
    const shown = todosOnDate(list, '2026-10-18')
    expect(shown.map((item) => [item.todo.id, item.done])).toEqual([
      ['past-open', false],
      ['past-done-before', false],
      ['past-done-today', false],
    ])
  })

  it('미완료는 이후 모든 날짜에 계속 보인다', () => {
    expect(ids(todosOnDate(list, '2026-12-31').map((item) => item.todo))).toEqual(['past-open', 'today', 'future'])
  })

  it('체크하면 체크한 날짜를 기록하고, 해제하면 지운다', () => {
    const checked = setTodoDone([todo('a', { date: '2026-10-18' })], 'a', true, '2026-10-20')
    expect(checked[0]).toMatchObject({ done: true, doneOn: '2026-10-20' })
    expect(setTodoDone(checked, 'a', false, '2026-10-20')[0]).toMatchObject({ done: false, doneOn: null })
  })
})

describe('할 일 목록', () => {
  it('지정한 항목 뒤에 넣는다 (-1이면 맨 앞)', () => {
    expect(ids(insertTodo([todo('a'), todo('b')], 0, todo('n')))).toEqual(['a', 'n', 'b'])
    expect(ids(insertTodo([todo('a')], -1, todo('n')))).toEqual(['n', 'a'])
  })

  it('Enter: 커서 위치에서 나누고 새 할 일은 보고 있는 날짜에 적는다', () => {
    const result = splitTodo([todo('a', { text: '장보기우유', date: '2026-10-18' })], 'a', 3, 'n', '2026-10-20')
    expect(result.map((item) => [item.id, item.text, item.date])).toEqual([
      ['a', '장보기', '2026-10-18'],
      ['n', '우유', '2026-10-20'],
    ])
  })

  it('삭제', () => {
    expect(ids(removeTodo([todo('a'), todo('b')], 'a'))).toEqual(['b'])
  })

  it('순서를 옮긴다', () => {
    expect(moveTodo(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveTodo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('날짜 화면에서 옮기면 보이지 않는 항목 위치는 그대로 둔다', () => {
    const list = [todo('a'), todo('hidden'), todo('b'), todo('c')]
    expect(ids(moveTodoInView(list, ['a', 'b', 'c'], 2, 0))).toEqual(['c', 'hidden', 'a', 'b'])
  })
})
