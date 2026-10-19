import { useState, type ChangeEvent } from 'react'
import { Download, RotateCcw, Upload } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { backupFileName, createBackup, downloadTextFile, parseBackup, serializeBackup } from '../../lib/backup'
import { createDefaultData } from '../../lib/defaults'
import type { AppData } from '../../lib/schema'
import type { AppState } from '../../lib/store'
import { Dialog } from '../common/Dialog'
import { ErrorMessage } from '../common/ErrorMessage'

/** 현재 데이터를 내려받는다. 저장 데이터가 손상된 상태면 손상된 원본을 그대로 내려받는다. */
function downloadCurrent(state: AppState) {
  if (state.invalid) {
    downloadTextFile(backupFileName(new Date(), 'work-schedule-corrupted'), state.invalid.raw)
  } else {
    downloadTextFile(backupFileName(), serializeBackup(createBackup(state.data)))
  }
}

type PendingAction =
  | { type: 'import'; data: AppData; exportedAt?: string; fileName: string }
  | { type: 'reset' }

export function DataManagement() {
  const store = useAppStore()
  const state = useAppState()
  const notify = useNotify()
  const [importErrors, setImportErrors] = useState<string[] | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = '' // 같은 파일을 다시 선택할 수 있게
    if (!file) return

    setImportErrors(null)
    const result = parseBackup(await file.text())
    if (!result.ok) {
      setImportErrors(result.errors)
      return
    }
    setPending({ type: 'import', data: result.data, exportedAt: result.exportedAt, fileName: file.name })
  }

  function apply(backupFirst: boolean) {
    if (!pending) return
    if (backupFirst) downloadCurrent(state)

    const next = pending.type === 'import' ? pending.data : createDefaultData()
    const result = store.replaceAll(next)
    setPending(null)
    if (result.ok) {
      notify(pending.type === 'import' ? '백업을 가져왔습니다.' : '모든 데이터를 초기화했습니다.')
    } else {
      setImportErrors(result.errors)
    }
  }

  return (
    <section className="card" aria-labelledby="data-management-title">
      <h3 id="data-management-title" className="section-title">
        데이터 백업·복원
      </h3>
      <p className="muted">
        데이터는 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 사라질 수 있으니 정기적으로 백업하세요.
      </p>
      {!state.invalid && (
        <p className="muted small">마지막 변경: {new Date(state.data.updatedAt).toLocaleString('ko-KR')}</p>
      )}

      <div className="button-row">
        <button type="button" className="button" onClick={() => downloadCurrent(state)}>
          <Download aria-hidden="true" size={18} />
          {state.invalid ? '손상된 원본 내려받기' : 'JSON 백업 내려받기'}
        </button>

        <label className="button">
          <Upload aria-hidden="true" size={18} />
          백업 파일 가져오기
          <input type="file" accept="application/json,.json" className="visually-hidden" onChange={handleFile} />
        </label>

        <button type="button" className="button button-danger" onClick={() => setPending({ type: 'reset' })}>
          <RotateCcw aria-hidden="true" size={18} />
          모든 데이터 초기화
        </button>
      </div>

      {importErrors && <ErrorMessage title="백업 파일을 가져올 수 없습니다." messages={importErrors} />}

      <Dialog
        open={pending !== null}
        title={pending?.type === 'import' ? '백업을 가져올까요?' : '모든 데이터를 초기화할까요?'}
        onClose={() => setPending(null)}
        actions={
          <>
            <button type="button" className="button" onClick={() => setPending(null)}>
              취소
            </button>
            <button type="button" className="button button-danger" onClick={() => apply(false)}>
              백업 없이 {pending?.type === 'import' ? '덮어쓰기' : '초기화'}
            </button>
            <button type="button" className="button button-primary" onClick={() => apply(true)}>
              현재 데이터 백업 후 {pending?.type === 'import' ? '가져오기' : '초기화'}
            </button>
          </>
        }
      >
        {pending?.type === 'import' ? (
          <>
            <p>
              현재 데이터가 <strong>{pending.fileName}</strong>의 내용으로 모두 바뀝니다.
            </p>
            <ul className="plain-list">
              {pending.exportedAt && <li>내보낸 시각: {new Date(pending.exportedAt).toLocaleString('ko-KR')}</li>}
              <li>일정 {pending.data.entries.length}건</li>
              <li>근무 유형 {pending.data.workTypes.length}개</li>
            </ul>
          </>
        ) : (
          <p>일정, 근무 유형, 급여·연차 설정이 모두 삭제되고 처음 상태로 돌아갑니다. 되돌릴 수 없습니다.</p>
        )}
      </Dialog>
    </section>
  )
}
