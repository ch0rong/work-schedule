import { useState, type FormEvent } from 'react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'

const MAX_LENGTH = 500

/** 날짜별 메모 (일정과 별개). 비우고 저장하면 지운다. 날짜가 바뀌면 key로 다시 만든다. */
export function DayNote({ date }: { date: string }) {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()
  const saved = data.dayNotes[date] ?? ''
  const [text, setText] = useState(saved)
  const [error, setError] = useState('')
  const dirty = text.trim() !== saved

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    const result = store.update((current) => {
      const dayNotes = { ...current.dayNotes }
      if (value) dayNotes[date] = value
      else delete dayNotes[date]
      return { ...current, dayNotes }
    })
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    setError('')
    setText(value)
    notify(value ? '메모를 저장했습니다.' : '메모를 지웠습니다.')
  }

  return (
    <form className="day-note-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="day-note" className="small">
        이 날짜 메모
      </label>
      <textarea id="day-note" rows={2} maxLength={MAX_LENGTH} value={text} placeholder="예: 회식, 교육, 제출 마감" onChange={(e) => setText(e.target.value)} />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {dirty && (
        <div className="button-row">
          <button type="submit" className="button button-small button-primary">
            메모 저장
          </button>
          <button type="button" className="button button-small" onClick={() => setText(saved)}>
            취소
          </button>
        </div>
      )}
    </form>
  )
}
