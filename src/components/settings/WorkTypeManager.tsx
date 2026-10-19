import { useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { CATEGORY_LABELS, createId, isWorkTypeInUse, removeWorkType, upsertWorkType } from '../../features/schedules/scheduleService'
import { workTypeSchema, type WorkType } from '../../lib/schema'
import { Dialog } from '../common/Dialog'

export function WorkTypeManager() {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()
  const [editing, setEditing] = useState<{ type: WorkType | null } | null>(null)
  const [deleting, setDeleting] = useState<WorkType | null>(null)
  const deletingInUse = deleting ? isWorkTypeInUse(data, deleting.id) : false

  function confirmDelete() {
    if (!deleting) return
    const result = deletingInUse
      ? store.update((current) => upsertWorkType(current, { ...deleting, archived: true }))
      : store.update((current) => removeWorkType(current, deleting.id))
    if (result.ok) notify(deletingInUse ? `${deleting.name} 유형을 숨겼습니다.` : `${deleting.name} 유형을 삭제했습니다.`)
    setDeleting(null)
  }

  return (
    <section className="card" aria-labelledby="work-types-title">
      <div className="card-header">
        <h3 id="work-types-title" className="section-title">
          근무 유형과 색상
        </h3>
        <button type="button" className="button button-primary" onClick={() => setEditing({ type: null })}>
          <Plus aria-hidden="true" size={18} />
          유형 추가
        </button>
      </div>

      <ul className="rule-list">
        {data.workTypes.map((type) => (
          <li key={type.id} className="rule-item">
            <div className="type-row">
              <span className="type-swatch" style={{ background: type.color }} aria-hidden="true" />
              <div>
                <p className="entry-item-title">
                  {type.name} {type.archived && <span className="badge">숨김</span>}
                </p>
                <p className="muted small">
                  {type.category === 'custom' ? '사용자 정의' : `${CATEGORY_LABELS[type.category]} 규칙`} · {type.countsAsWork ? '근무시간에 포함' : '근무시간 제외'}
                </p>
              </div>
            </div>
            <div className="button-row">
              <button type="button" className="button button-small" onClick={() => setEditing({ type })} aria-label={`${type.name} 수정`}>
                <Pencil aria-hidden="true" size={16} />
              </button>
              <button
                type="button"
                className="button button-small button-danger"
                onClick={() => setDeleting(type)}
                aria-label={`${type.name} 삭제`}
                disabled={type.archived}
              >
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} title={editing?.type ? '근무 유형 수정' : '근무 유형 추가'} onClose={() => setEditing(null)}>
        {editing && <WorkTypeForm key={editing.type?.id ?? 'new'} type={editing.type} onDone={() => setEditing(null)} />}
      </Dialog>

      <Dialog
        open={deleting !== null}
        title={deletingInUse ? '사용 중인 유형입니다' : '근무 유형을 삭제할까요?'}
        onClose={() => setDeleting(null)}
        actions={
          <>
            <button type="button" className="button" onClick={() => setDeleting(null)}>
              취소
            </button>
            <button type="button" className="button button-danger" onClick={confirmDelete}>
              {deletingInUse ? '숨기기' : '삭제'}
            </button>
          </>
        }
      >
        <p>
          {deletingInUse
            ? `${deleting?.name} 유형은 기존 일정에서 사용 중이라 삭제할 수 없습니다. 숨기면 새 일정에서 선택할 수 없지만 기존 일정은 그대로 유지됩니다.`
            : `${deleting?.name} 유형을 삭제합니다.`}
        </p>
      </Dialog>
    </section>
  )
}

function WorkTypeForm({ type, onDone }: { type: WorkType | null; onDone: () => void }) {
  const store = useAppStore()
  const notify = useNotify()
  const [name, setName] = useState(type?.name ?? '')
  const [color, setColor] = useState(type?.color ?? '#4776E6')
  const [countsAsWork, setCountsAsWork] = useState(type?.countsAsWork ?? true)
  const [archived, setArchived] = useState(type?.archived ?? false)
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = workTypeSchema.safeParse({ id: type?.id ?? createId(), name, color, countsAsWork, archived, category: type?.category ?? 'custom' })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.')
      return
    }
    const result = store.update((current) => upsertWorkType(current, parsed.data))
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    notify(type ? '근무 유형을 수정했습니다.' : '근무 유형을 추가했습니다.')
    onDone()
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="type-name">이름</label>
        <input
          id="type-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'type-error' : undefined}
        />
      </div>
      <div className="field">
        <label htmlFor="type-color">색상</label>
        <input id="type-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={countsAsWork} onChange={(e) => setCountsAsWork(e.target.checked)} />
        근무시간 합계와 급여에 포함
      </label>
      {type && (
        <label className="checkbox">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          숨김 (새 일정에서 선택하지 않음)
        </label>
      )}
      {error && (
        <p id="type-error" className="field-error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onDone}>
          취소
        </button>
        <button type="submit" className="button button-primary">
          저장
        </button>
      </div>
    </form>
  )
}
