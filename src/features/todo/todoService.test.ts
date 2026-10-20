import { describe, expect, it } from 'vitest'
import { clearDoneTodos, insertTodo, moveTodo, removeTodo, splitTodo, updateTodo } from './todoService'

const todo = (id: string, text = id, done = false) => ({ id, text, done })

describe('할 일 목록', () => {
  it('지정한 항목 뒤에 넣는다 (-1이면 맨 앞)', () => {
    expect(insertTodo([todo('a'), todo('b')], 0, todo('n')).map((item) => item.id)).toEqual(['a', 'n', 'b'])
    expect(insertTodo([todo('a')], -1, todo('n')).map((item) => item.id)).toEqual(['n', 'a'])
  })

  it('Enter: 커서 위치에서 나누고, 끝이면 빈 할 일을 추가한다', () => {
    expect(splitTodo([todo('a', '장보기우유')], 'a', 3, 'n')).toEqual([todo('a', '장보기'), todo('n', '우유')])
    expect(splitTodo([todo('a', '보고서', true), todo('b')], 'a', 3, 'n')).toEqual([todo('a', '보고서', true), todo('n', ''), todo('b')])
  })

  it('수정·삭제·완료 항목 지우기', () => {
    expect(updateTodo([todo('a')], 'a', { done: true })).toEqual([todo('a', 'a', true)])
    expect(removeTodo([todo('a'), todo('b')], 'a')).toEqual([todo('b')])
    expect(clearDoneTodos([todo('a', 'a', true), todo('b')])).toEqual([todo('b')])
  })

  it('순서를 옮긴다', () => {
    const list = [todo('a'), todo('b'), todo('c')]
    expect(moveTodo(list, 0, 2).map((item) => item.id)).toEqual(['b', 'c', 'a'])
    expect(moveTodo(list, 2, 0).map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(moveTodo(list, 1, 9).map((item) => item.id)).toEqual(['a', 'c', 'b'])
  })
})
