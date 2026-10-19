import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { COMP_STATUS_LABELS, summarizeCompLeave } from '../../features/leave/compLeaveService'
import { formatLeaveAmount } from '../../features/leave/leaveService'
import { describeEntryTime, entryTitle, removeEntry } from '../../features/schedules/scheduleService'
import { toDateString } from '../../lib/date'
import type { Entry, LeaveType } from '../../lib/schema'
import { Dialog } from '../common/Dialog'
import { EntryForm } from './EntryForm'

/** 일정 대화상자에 무엇을 띄울지 */
export type EntryDialogTarget =
  | { mode: 'create'; date: string; kind?: Entry['kind']; startTime?: string; leaveType?: LeaveType }
  | { mode: 'view'; entryId: string }

interface EntryDialogProps {
  target: EntryDialogTarget | null
  onClose: () => void
}

/** 일정 추가 · 상세 보기 · 수정 · 삭제를 하나의 대화상자에서 처리한다. */
export function EntryDialog({ target, onClose }: EntryDialogProps) {
  // target이 바뀌면 내부 단계를 초기화한다
  return <EntryDialogInner key={target ? JSON.stringify(target) : 'closed'} target={target} onClose={onClose} />
}

function EntryDialogInner({ target, onClose }: EntryDialogProps) {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()
  const [step, setStep] = useState<'details' | 'edit' | 'delete'>('details')

  const entry = target?.mode === 'view' ? data.entries.find((item) => item.id === target.entryId) : undefined
  const open = target !== null && (target.mode === 'create' || entry !== undefined)
  const compGrant = entry ? summarizeCompLeave(data, toDateString(new Date())).grants.find((grant) => grant.entryId === entry.id) : undefined

  let title = '일정 추가'
  if (entry) title = step === 'edit' ? '일정 수정' : step === 'delete' ? '일정을 삭제할까요?' : entryTitle(entry, data)

  function handleDelete() {
    if (!entry) return
    const result = store.update((current) => removeEntry(current, entry.id))
    if (result.ok) notify('일정을 삭제했습니다.')
    onClose()
  }

  return (
    <Dialog open={open} title={title} onClose={onClose}>
      {target?.mode === 'create' && (
        <EntryForm
          defaultDate={target.date}
          defaultKind={target.kind}
          defaultStartTime={target.startTime}
          defaultLeaveType={target.leaveType}
          onDone={onClose}
          onCancel={onClose}
        />
      )}

      {entry && step === 'details' && (
        <>
          <dl className="detail-list">
            <div>
              <dt>종류</dt>
              <dd>{entry.kind === 'work' ? '근무' : entry.kind === 'trip' ? '출장' : '휴가·근태'}</dd>
            </div>
            {entry.kind === 'work' && (
              <div>
                <dt>날짜</dt>
                <dd>{entry.endsNextDay ? `${entry.date} ~ ${entry.endDate}` : entry.date}</dd>
              </div>
            )}
            <div>
              <dt>{entry.kind === 'leave' ? '기간' : '시간'}</dt>
              <dd>{describeEntryTime(entry, data.settings)}</dd>
            </div>
            {compGrant && (
              <div>
                <dt>대체휴무</dt>
                <dd>
                  {formatLeaveAmount(compGrant.minutes, data.settings.leave.minutesPerDay)} 발생 · 사용 기한 ~{compGrant.lastUsableDate} ·{' '}
                  <strong className={compGrant.status === 'overdue' ? 'text-danger' : undefined}>{COMP_STATUS_LABELS[compGrant.status]}</strong>
                  {compGrant.status !== 'used' && ` (잔여 ${formatLeaveAmount(compGrant.remainingMinutes, data.settings.leave.minutesPerDay)})`}
                </dd>
              </div>
            )}
            {entry.note && (
              <div>
                <dt>메모</dt>
                <dd className="pre-wrap">{entry.note}</dd>
              </div>
            )}
          </dl>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              닫기
            </button>
            <button type="button" className="button button-danger" onClick={() => setStep('delete')}>
              <Trash2 aria-hidden="true" size={18} />
              삭제
            </button>
            <button type="button" className="button button-primary" onClick={() => setStep('edit')}>
              <Pencil aria-hidden="true" size={18} />
              수정
            </button>
          </div>
        </>
      )}

      {entry && step === 'edit' && (
        <EntryForm entry={entry} defaultDate={entry.date} onDone={onClose} onCancel={() => setStep('details')} />
      )}

      {entry && step === 'delete' && (
        <>
          <p>
            {entry.date} {entryTitle(entry, data)} 일정을 삭제합니다. 되돌릴 수 없습니다.
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setStep('details')}>
              취소
            </button>
            <button type="button" className="button button-danger" onClick={handleDelete}>
              삭제
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
