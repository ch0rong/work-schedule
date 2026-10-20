import type { AppData, Todo } from '../../lib/schema'

/** 할 일 목록 조작 (순수 함수). 화면 순서 = 배열 순서 */

/** 날짜 화면에 보이는 할 일: carried — 이전 날짜에서 넘어온 것, done — 이 날짜 기준 완료 */
export interface DayTodo {
  todo: Todo
  carried: boolean
  done: boolean
}

/** 완료 날짜 (이전 데이터에 없으면 적은 날짜) */
const doneDate = (todo: Todo) => todo.doneOn ?? todo.date

/**
 * date에 보일 할 일: 그날 적은 것 + 이전에 적었는데 그날까지 완료하지 않은 것.
 * 완료한 날 이후로는 보이지 않는다. 완료한 날보다 앞선 날짜에서는 미완료로 보인다.
 */
export function todosOnDate(todos: readonly Todo[], date: string): DayTodo[] {
  return todos.flatMap((todo) => {
    if (todo.date > date) return []
    const finished = todo.done && doneDate(todo) <= date
    if (todo.date < date && finished && doneDate(todo) < date) return []
    return [{ todo, carried: todo.date < date, done: finished }]
  })
}

/** index 뒤에 새 할 일을 넣는다. index가 -1이면 맨 앞 */
export function insertTodo(todos: readonly Todo[], index: number, todo: Todo): Todo[] {
  return [...todos.slice(0, index + 1), todo, ...todos.slice(index + 1)]
}

/** afterId 뒤에 넣는다. afterId가 없으면 맨 뒤 */
export function insertTodoAfter(todos: readonly Todo[], afterId: string | null, todo: Todo): Todo[] {
  const index = afterId === null ? -1 : todos.findIndex((item) => item.id === afterId)
  return index < 0 ? [...todos, todo] : insertTodo(todos, index, todo)
}

/**
 * Enter: 커서 위치에서 나눠 뒤쪽 글자를 다음 할 일로 만든다 (노션과 같음).
 * 커서가 끝에 있으면 빈 할 일이 추가된다. 새 할 일은 보고 있는 날짜(date)에 적는다.
 */
export function splitTodo(todos: readonly Todo[], id: string, caret: number, newId: string, date: string): Todo[] {
  const current = todos.find((todo) => todo.id === id)
  if (!current) return [...todos]
  const next = todos.map((todo) => (todo.id === id ? { ...todo, text: current.text.slice(0, caret) } : todo))
  return insertTodoAfter(next, id, { id: newId, text: current.text.slice(caret), done: false, date, doneOn: null })
}

export function updateTodo(todos: readonly Todo[], id: string, patch: Partial<Omit<Todo, 'id'>>): Todo[] {
  return todos.map((todo) => (todo.id === id ? { ...todo, ...patch } : todo))
}

/** 완료 체크: 체크한 날짜를 기록한다 (그날까지 목록에 남음) */
export function setTodoDone(todos: readonly Todo[], id: string, done: boolean, date: string): Todo[] {
  return updateTodo(todos, id, { done, doneOn: done ? date : null })
}

export function removeTodo(todos: readonly Todo[], id: string): Todo[] {
  return todos.filter((todo) => todo.id !== id)
}

/** from 위치의 항목을 to 위치로 옮긴다 */
export function moveTodo<T>(todos: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= todos.length) return [...todos]
  const next = [...todos]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

/**
 * 날짜 화면(일부 항목만 보임)에서 순서를 바꾼다.
 * 보이는 항목들이 차지하던 자리에 바뀐 순서대로 다시 채워, 보이지 않는 항목의 위치는 그대로 둔다.
 */
export function moveTodoInView(todos: readonly Todo[], visibleIds: readonly string[], from: number, to: number): Todo[] {
  const reordered = moveTodo(visibleIds, from, to)
  const visible = new Set(visibleIds)
  const byId = new Map(todos.map((todo) => [todo.id, todo]))
  let slot = 0
  return todos.map((todo) => (visible.has(todo.id) ? byId.get(reordered[slot++])! : todo))
}

export const withTodos = (data: AppData, todos: Todo[]): AppData => ({ ...data, todos })
