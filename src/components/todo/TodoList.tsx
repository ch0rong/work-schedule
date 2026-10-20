import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { GripVertical, Plus, X } from 'lucide-react'
import { useAppState, useAppStore } from '../../app/storeContext'
import { createId } from '../../features/schedules/scheduleService'
import { insertTodoAfter, moveTodo, moveTodoInView, removeTodo, setTodoDone, splitTodo, todosOnDate, updateTodo, withTodos } from '../../features/todo/todoService'
import { parseDateString } from '../../lib/date'
import type { Todo } from '../../lib/schema'

const MAX_LENGTH = 500
const dateLabel = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

/** 드래그 중인 항목: 시작 위치, 현재 놓일 위치, 시작할 때 각 행의 세로 중앙(페이지 기준) */
interface DragState {
  id: string
  from: number
  over: number
  mids: number[]
}

/**
 * 노션 스타일 날짜별 할 일 목록. 선택한 날짜에 적고, 완료하지 않은 할 일은 완료할 때까지 이후 날짜에도 보인다.
 * - 글자를 누르면 바로 고친다 (수정 버튼 없음). 고칠 때마다 저장·동기화된다.
 * - Enter: 다음 할 일 추가(커서 위치에서 나눔), 빈 칸에서 Backspace 또는 ×: 삭제, 맨 앞에서 Backspace: 위 항목과 합침
 * - ↑/↓: 위아래 항목으로 이동, Alt+↑/↓ 또는 손잡이 드래그: 순서 변경
 */
export function TodoList({ date }: { date: string }) {
  const store = useAppStore()
  const { data } = useAppState()
  const items = todosOnDate(data.todos, date)
  const visible = items.map((item) => item.todo)
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())
  const rows = useRef(new Map<string, HTMLLIElement>())
  const [focus, setFocus] = useState<{ id: string; caret: number } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [error, setError] = useState('')
  const parsed = parseDateString(date)

  // 추가·삭제·합치기 뒤 원하는 항목의 원하는 위치로 커서를 옮긴다
  useLayoutEffect(() => {
    if (!focus) return
    const input = inputs.current.get(focus.id)
    if (!input) return
    input.focus()
    const caret = Math.min(focus.caret, input.value.length)
    input.setSelectionRange(caret, caret)
    setFocus(null)
  }, [focus, data.todos])

  function save(change: (todos: Todo[]) => Todo[]): boolean {
    const result = store.update((current) => withTodos(current, change(current.todos)))
    setError(result.ok ? '' : result.errors.join(' '))
    return result.ok
  }

  /** 보이는 목록에서 순서 변경 (다른 날짜에만 보이는 항목 위치는 그대로) */
  const moveVisible = (from: number, to: number) =>
    save((list) => {
      const ids = todosOnDate(list, date).map((item) => item.todo.id)
      return moveTodoInView(list, ids, from, to)
    })

  function addLast() {
    const id = createId()
    const last = visible.at(-1)?.id ?? null
    if (save((list) => insertTodoAfter(list, last, { id, text: '', done: false, date, doneOn: null }))) setFocus({ id, caret: 0 })
  }

  function remove(todo: Todo, index: number) {
    const target = visible[index - 1] ?? visible[index + 1]
    if (save((list) => removeTodo(list, todo.id)) && target) setFocus({ id: target.id, caret: visible[index - 1] ? target.text.length : 0 })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, todo: Todo, index: number) {
    // 한글 입력(조합) 중의 Enter·방향키는 IME가 처리한다
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const input = event.currentTarget
    const caretAtStart = input.selectionStart === 0 && input.selectionEnd === 0
    const caretAtEnd = input.selectionStart === input.value.length

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const id = createId()
      if (save((list) => splitTodo(list, todo.id, input.selectionStart, id, date))) setFocus({ id, caret: 0 })
      return
    }
    if (event.key === 'Backspace' && caretAtStart) {
      const previous = visible[index - 1]
      if (todo.text === '') {
        event.preventDefault()
        remove(todo, index)
        return
      }
      if (previous) {
        event.preventDefault()
        const caret = previous.text.length
        const merged = (previous.text + todo.text).slice(0, MAX_LENGTH)
        if (save((list) => removeTodo(updateTodo(list, previous.id, { text: merged }), todo.id))) setFocus({ id: previous.id, caret })
      }
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const step = event.key === 'ArrowUp' ? -1 : 1
      const target = visible[index + step]
      if (!target) return
      if (event.altKey) {
        event.preventDefault()
        if (moveVisible(index, index + step)) setFocus({ id: todo.id, caret: input.selectionStart })
        return
      }
      // 여러 줄로 감긴 글은 첫 줄·마지막 줄에서만 다른 항목으로 넘어간다
      if ((step < 0 && caretAtStart) || (step > 0 && caretAtEnd)) {
        event.preventDefault()
        setFocus({ id: target.id, caret: step < 0 ? target.text.length : 0 })
      }
    }
  }

  // ---------- 드래그 앤 드롭 (마우스·터치 공통: 포인터 이벤트) ----------
  function startDrag(event: PointerEvent<HTMLButtonElement>, todo: Todo, index: number) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const mids = visible.map((item) => {
      const rect = rows.current.get(item.id)?.getBoundingClientRect()
      return rect ? rect.top + rect.height / 2 + window.scrollY : 0
    })
    setDrag({ id: todo.id, from: index, over: index, mids })
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!drag) return
    const y = event.clientY + window.scrollY
    const over = drag.mids.filter((mid, index) => index !== drag.from && mid < y).length
    if (over !== drag.over) setDrag({ ...drag, over })
  }

  function endDrag(cancel = false) {
    if (!drag) return
    const { id, over } = drag
    setDrag(null)
    if (cancel) return
    // 드래그 중 다른 기기 변경으로 목록이 바뀌었을 수 있어 id로 다시 찾는다
    save((list) => {
      const ids = todosOnDate(list, date).map((item) => item.todo.id)
      return moveTodoInView(list, ids, ids.indexOf(id), over)
    })
  }

  const shown = drag ? moveTodo(items, drag.from, drag.over) : items
  const doneCount = items.filter((item) => item.done).length

  return (
    <section className="card todo-card" aria-label="할 일">
      <div className="card-header">
        <h3 className="section-title">
          할 일 <span className="muted small">{parsed ? dateLabel.format(parsed) : date}</span>
        </h3>
        {items.length > 0 && (
          <span className="muted small" aria-live="polite">
            {doneCount}/{items.length} 완료
          </span>
        )}
      </div>

      {items.length === 0 && <p className="muted small">이 날짜의 할 일이 없습니다. 완료하지 않은 할 일은 다음 날짜에도 이어서 보입니다.</p>}

      <ul className={`todo-list${drag ? ' is-sorting' : ''}`} aria-label="할 일 목록">
        {shown.map(({ todo, carried, done }) => {
          const index = visible.indexOf(todo)
          const name = `"${todo.text || '빈 할 일'}"`
          return (
            <li
              key={todo.id}
              ref={(element) => {
                if (element) rows.current.set(todo.id, element)
                else rows.current.delete(todo.id)
              }}
              className={`todo-item${done ? ' is-done' : ''}${drag?.id === todo.id ? ' is-dragging' : ''}`}
            >
              <button
                type="button"
                className="todo-handle"
                aria-label={`${name} 순서 변경 (끌어서 옮기거나 Alt+↑/↓)`}
                onPointerDown={(event) => startDrag(event, todo, index)}
                onPointerMove={moveDrag}
                onPointerUp={() => endDrag()}
                onPointerCancel={() => endDrag(true)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  moveVisible(index, index + (event.key === 'ArrowUp' ? -1 : 1))
                }}
              >
                <GripVertical aria-hidden="true" size={16} />
              </button>
              <input
                type="checkbox"
                className="todo-check"
                checked={done}
                aria-label={`${name} 완료`}
                onChange={(event) => save((list) => setTodoDone(list, todo.id, event.target.checked, date))}
              />
              <div className="todo-body">
                <textarea
                  ref={(element) => {
                    if (element) inputs.current.set(todo.id, element)
                    else inputs.current.delete(todo.id)
                  }}
                  className="todo-text"
                  rows={1}
                  value={todo.text}
                  maxLength={MAX_LENGTH}
                  placeholder="할 일"
                  aria-label="할 일 내용"
                  onChange={(event) => save((list) => updateTodo(list, todo.id, { text: event.target.value.replace(/\r?\n/g, ' ') }))}
                  onKeyDown={(event) => handleKeyDown(event, todo, index)}
                />
                {carried && (
                  <span className="todo-since" title={`${todo.date}에 적은 할 일`}>
                    {shortDate(todo.date)}부터
                  </span>
                )}
              </div>
              <button type="button" className="todo-delete" aria-label={`${name} 삭제`} title="삭제" onClick={() => remove(todo, index)}>
                <X aria-hidden="true" size={16} />
              </button>
            </li>
          )
        })}
      </ul>

      <button type="button" className="todo-add" onClick={addLast}>
        <Plus aria-hidden="true" size={16} />
        할 일 추가
      </button>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
