import type { AppData, Todo } from '../../lib/schema'

/** 할 일 목록 조작 (순수 함수). 화면 순서 = 배열 순서 */

/** index 뒤에 새 할 일을 넣는다. index가 -1이면 맨 앞 */
export function insertTodo(todos: readonly Todo[], index: number, todo: Todo): Todo[] {
  return [...todos.slice(0, index + 1), todo, ...todos.slice(index + 1)]
}

/**
 * Enter: 커서 위치에서 나눠 뒤쪽 글자를 다음 할 일로 만든다 (노션과 같음).
 * 커서가 끝에 있으면 빈 할 일이 추가된다.
 */
export function splitTodo(todos: readonly Todo[], id: string, caret: number, newId: string): Todo[] {
  const index = todos.findIndex((todo) => todo.id === id)
  if (index < 0) return [...todos]
  const current = todos[index]
  const before = current.text.slice(0, caret)
  const after = current.text.slice(caret)
  const next = todos.map((todo) => (todo.id === id ? { ...todo, text: before } : todo))
  return insertTodo(next, index, { id: newId, text: after, done: false })
}

export function updateTodo(todos: readonly Todo[], id: string, patch: Partial<Omit<Todo, 'id'>>): Todo[] {
  return todos.map((todo) => (todo.id === id ? { ...todo, ...patch } : todo))
}

export function removeTodo(todos: readonly Todo[], id: string): Todo[] {
  return todos.filter((todo) => todo.id !== id)
}

/** from 위치의 항목을 to 위치로 옮긴다 (드래그 앤 드롭·키보드 이동) */
export function moveTodo(todos: readonly Todo[], from: number, to: number): Todo[] {
  if (from === to || from < 0 || from >= todos.length) return [...todos]
  const next = [...todos]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

export function clearDoneTodos(todos: readonly Todo[]): Todo[] {
  return todos.filter((todo) => !todo.done)
}

export const withTodos = (data: AppData, todos: Todo[]): AppData => ({ ...data, todos })
