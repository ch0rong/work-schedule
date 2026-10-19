import { useState } from 'react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { removeMealUsage, summarizeMeals, upsertMealUsage, validateMealUsage, type MealOccurrence } from '../../features/meal/mealService'
import { createId } from '../../features/schedules/scheduleService'
import { toDateString } from '../../lib/date'
import type { MealUsage } from '../../lib/schema'
import { formatMinutes } from '../../lib/time'
import { Dialog } from '../common/Dialog'
import { ErrorMessage } from '../common/ErrorMessage'

interface MealPanelProps {
  month: string | null
  /** 이 발생일의 사용 내역을 바로 편집 */
  focusDate?: string
  onClose: () => void
}

/** 메인 달력 화면의 매식비 패널: 월별 발생·사용·잔여, 사용 처리 */
export function MealPanel({ month, focusDate, onClose }: MealPanelProps) {
  const { data } = useAppState()
  const [editing, setEditing] = useState<string | null>(focusDate ?? null)
  if (!month) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>
  const summary = summarizeMeals(data, month)

  return (
    <Dialog open title={`${Number(month.slice(5))}월 매식비`} onClose={onClose}>
      <div className="summary-grid compact">
        <div className="stat-card">
          <p className="stat-label">발생</p>
          <p className="stat-value">{summary.occurred}건</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">사용 완료</p>
          <p className="stat-value">{summary.used}건</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">잔여</p>
          <p className="stat-value">{summary.remaining}건</p>
        </div>
      </div>
      <p className="muted small">
        정규근무 종료 후 연장근무 {formatMinutes(data.settings.meal.minOvertimeMinutes)} 이상인 날 1건 발생 ·{' '}
        {data.settings.meal.allowCarryOver ? '다음 달 사용 허용' : '발생한 달 안에서만 사용'}
      </p>

      {summary.occurrences.length === 0 ? (
        <p className="muted">이 달에 발생한 매식비가 없습니다.</p>
      ) : (
        <ul className="entry-list">
          {summary.occurrences.map((occurrence) => (
            <li key={occurrence.date} className="rule-item">
              <div>
                <p className="entry-item-title">
                  {occurrence.date} 발생 <span className={`badge ${occurrence.usage?.used ? 'badge-done' : 'badge-meal'}`}>{occurrence.usage?.used ? '사용 완료' : '미사용'}</span>
                </p>
                <p className="muted small">
                  {occurrence.reason}
                  {occurrence.usage?.usedDate && ` · 사용일 ${occurrence.usage.usedDate}`}
                  {occurrence.usage?.place && ` · ${occurrence.usage.place}`}
                </p>
              </div>
              {editing === occurrence.date ? (
                <UsageForm occurrence={occurrence} onDone={() => setEditing(null)} />
              ) : (
                <button type="button" className="button button-small" onClick={() => setEditing(occurrence.date)}>
                  {occurrence.usage ? '사용 내역 수정' : '사용 처리'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {summary.orphanUsages.length > 0 && (
        <ErrorMessage
          title="발생 건이 사라진 사용 내역이 있습니다 (연장근무가 삭제·변경됨)"
          messages={summary.orphanUsages.map((usage) => `${usage.sourceDate} 발생분 — ${usage.used ? `사용일 ${usage.usedDate}` : '미사용'}`)}
        />
      )}

      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}

function UsageForm({ occurrence, onDone }: { occurrence: MealOccurrence; onDone: () => void }) {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()
  const today = toDateString(new Date())
  const existing = occurrence.usage
  const [usedDate, setUsedDate] = useState(existing?.usedDate ?? (today.slice(0, 7) === occurrence.date.slice(0, 7) && today >= occurrence.date ? today : occurrence.date))
  const [place, setPlace] = useState(existing?.place ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [errors, setErrors] = useState<string[]>([])

  function save(used: boolean) {
    const usage: MealUsage = { id: existing?.id ?? createId(), sourceDate: occurrence.date, usedDate: usedDate || null, place: place.trim(), used, note: note.trim() }
    const problems = validateMealUsage(data, usage)
    if (problems.length > 0) {
      setErrors(problems)
      return
    }
    const result = store.update((current) => upsertMealUsage(current, usage))
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    notify(used ? '매식비를 사용 처리했습니다.' : '매식비 사용 내역을 저장했습니다.')
    onDone()
  }

  return (
    <div className="usage-form">
      <div className="field-row">
        <div className="field">
          <label htmlFor={`used-${occurrence.date}`}>실제 사용일</label>
          <input id={`used-${occurrence.date}`} type="date" value={usedDate} min={occurrence.date} onChange={(e) => setUsedDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`place-${occurrence.date}`}>사용처</label>
          <input id={`place-${occurrence.date}`} value={place} maxLength={100} onChange={(e) => setPlace(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`note-${occurrence.date}`}>비고</label>
        <input id={`note-${occurrence.date}`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </div>
      {errors.length > 0 && <ErrorMessage title="저장하지 못했습니다." messages={errors} />}
      <div className="button-row">
        <button type="button" className="button button-primary button-small" onClick={() => save(true)}>
          사용 완료
        </button>
        {existing?.used && (
          <button type="button" className="button button-small" onClick={() => save(false)}>
            미사용으로 되돌리기
          </button>
        )}
        {existing && (
          <button
            type="button"
            className="button button-small button-danger"
            onClick={() => {
              if (store.update((current) => removeMealUsage(current, existing.id)).ok) notify('사용 내역을 삭제했습니다.')
              onDone()
            }}
          >
            내역 삭제
          </button>
        )}
        <button type="button" className="button button-small" onClick={onDone}>
          취소
        </button>
      </div>
    </div>
  )
}
