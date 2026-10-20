import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import { useAppState, useAppStore } from '../../app/storeContext'
import { createId } from '../../features/schedules/scheduleService'
import { insertTodo, moveTodo, removeTodo, splitTodo, updateTodo, withTodos } from '../../features/todo/todoService'
import type { Todo } from '../../lib/schema'

const MAX_LENGTH = 500

/** 드래그 중인 항목: 시작 위치, 현재 놓일 위치, 시작할 때 각 행의 세로 중앙(페이지 기준) */
interface DragState {
  id: string
  from: number
  over: number
  mids: number[]
}

/**
 * 노션 스타일 할 일 목록.
 * - 글자를 누르면 바로 고친다 (수정 버튼 없음). 고칠 때마다 저장·동기화된다.
 * - Enter: 다음 할 일 추가(커서 위치에서 나눔), 빈 칸에서 Backspace: 지우고 위 항목으로, 맨 앞에서 Backspace: 위 항목과 합침
 * - ↑/↓: 위아래 항목으로 이동, Alt+↑/↓ 또는 손잡이 드래그: 순서 변경
 */
export function TodoList() {
  const store = useAppStore()
  const { data } = useAppState()
  const todos = data.todos
  const inputs = useRef(new Map<string, HTMLTextAreaElement>())
  const rows = useRef(new Map<string, HTMLLIElement>())
  const [focus, setFocus] = useState<{ id: string; caret: number } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [error, setError] = useState('')

  // 추가·삭제·합치기 뒤 원하는 항목의 원하는 위치로 커서를 옮긴다
  useLayoutEffect(() => {
    if (!focus) return
    const input = inputs.current.get(focus.id)
    if (!input) return
    input.focus()
    const caret = Math.min(focus.caret, input.value.length)
    input.setSelectionRange(caret, caret)
    setFocus(null)
  }, [focus, todos])

  function save(change: (todos: Todo[]) => Todo[]): boolean {
    const result = store.update((current) => withTodos(current, change(current.todos)))
    setError(result.ok ? '' : result.errors.join(' '))
    return result.ok
  }

  function addAt(index: number) {
    const id = createId()
    if (save((list) => insertTodo(list, index, { id, text: '', done: false }))) setFocus({ id, caret: 0 })
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
      if (save((list) => splitTodo(list, todo.id, input.selectionStart, id))) setFocus({ id, caret: 0 })
      return
    }
    if (event.key === 'Backspace' && caretAtStart) {
      const previous = todos[index - 1]
      if (todo.text === '') {
        event.preventDefault()
        const target = previous ?? todos[index + 1]
        if (save((list) => removeTodo(list, todo.id)) && target) setFocus({ id: target.id, caret: previous ? previous.text.length : 0 })
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
      const target = todos[index + step]
      if (!target) return
      if (event.altKey) {
        event.preventDefault()
        if (save((list) => moveTodo(list, index, index + step))) setFocus({ id: todo.id, caret: input.selectionStart })
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
    const mids = todos.map((item) => {
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
    save((list) => moveTodo(list, list.findIndex((item) => item.id === id), over))
  }

  const shown = drag ? moveTodo(todos, drag.from, drag.over) : todos
  const doneCount = todos.filter((todo) => todo.done).length

  return (
    <section className="card todo-card" aria-labelledby="todo-title">
      <div className="card-header">
        <h3 id="todo-title" className="section-title">
          할 일
        </h3>
        {todos.length > 0 && (
          <span className="muted small" aria-live="polite">
            {doneCount}/{todos.length} 완료
          </span>
        )}
      </div>

      {todos.length === 0 && <p className="muted small">아래 버튼이나 Enter로 할 일을 추가하세요.</p>}

      <ul className={`todo-list${drag ? ' is-sorting' : ''}`} aria-label="할 일 목록">
        {shown.map((todo) => {
          const index = todos.indexOf(todo)
          return (
            <li
              key={todo.id}
              ref={(element) => {
                if (element) rows.current.set(todo.id, element)
                else rows.current.delete(todo.id)
              }}
              className={`todo-item${todo.done ? ' is-done' : ''}${drag?.id === todo.id ? ' is-dragging' : ''}`}
            >
              <button
                type="button"
                className="todo-handle"
                aria-label={`"${todo.text || '빈 할 일'}" 순서 변경 (끌어서 옮기거나 Alt+↑/↓)`}
                onPointerDown={(event) => startDrag(event, todo, index)}
                onPointerMove={moveDrag}
                onPointerUp={() => endDrag()}
                onPointerCancel={() => endDrag(true)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  save((list) => moveTodo(list, index, index + (event.key === 'ArrowUp' ? -1 : 1)))
                }}
              >
                <GripVertical aria-hidden="true" size={16} />
              </button>
              <input
                type="checkbox"
                className="todo-check"
                checked={todo.done}
                aria-label={`"${todo.text || '빈 할 일'}" 완료`}
                onChange={(event) => save((list) => updateTodo(list, todo.id, { done: event.target.checked }))}
              />
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
            </li>
          )
        })}
      </ul>

      <button type="button" className="todo-add" onClick={() => addAt(todos.length - 1)}>
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
