import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, LogOut, RefreshCw } from 'lucide-react'
import { Dialog } from '../components/common/Dialog'
import type { SyncStatus } from '../lib/store'
import { useSession } from './sessionContext'
import { useAppState } from './storeContext'

const STATUS: Record<SyncStatus, { label: string; icon: typeof CheckCircle2 }> = {
  idle: { label: '동기화됨', icon: CheckCircle2 },
  saving: { label: '저장 중…', icon: Loader2 },
  saved: { label: '저장됨', icon: CheckCircle2 },
  error: { label: '저장 실패', icon: CloudOff },
  conflict: { label: '충돌', icon: AlertTriangle },
  auth: { label: '로그인 필요', icon: AlertTriangle },
}

/** 헤더 오른쪽: 저장 상태, 계정, 로그아웃 (로컬 개발 모드에서는 모드 표시만) */
export function SessionBar() {
  const session = useSession()
  const { syncStatus } = useAppState()
  const [confirm, setConfirm] = useState(false)
  if (!session) {
    return <span className="badge badge-warning">개발용 로컬 모드 · 이 브라우저에만 저장</span>
  }
  const status = STATUS[syncStatus]
  const Icon = status.icon
  return (
    <div className="session-bar">
      <span className={`sync-status sync-${syncStatus}`} role="status" aria-live="polite">
        <Icon aria-hidden="true" size={16} />
        {status.label}
      </span>
      <span className="session-email small">{session.email}</span>
      <button type="button" className="button button-small" onClick={() => setConfirm(true)}>
        <LogOut aria-hidden="true" size={16} />
        로그아웃
      </button>
      <Dialog
        open={confirm}
        title="로그아웃할까요?"
        onClose={() => setConfirm(false)}
        actions={
          <>
            <button type="button" className="button" onClick={() => setConfirm(false)}>
              취소
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setConfirm(false)
                void session.logout()
              }}
            >
              로그아웃
            </button>
          </>
        }
      >
        <p>저장 중인 변경이 있으면 저장을 마친 뒤 로그아웃합니다. 이 브라우저에는 근무·급여 데이터가 남지 않습니다.</p>
      </Dialog>
    </div>
  )
}

/** 로그인 만료·동기화 충돌 안내 */
export function SessionAlerts() {
  const session = useSession()
  const { syncStatus, saveError } = useAppState()
  const [busy, setBusy] = useState(false)
  if (!session) return null

  const run = (action: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  if (session.expired || syncStatus === 'auth') {
    return (
      <div className="alert alert-warning" role="alert">
        <AlertTriangle aria-hidden="true" size={18} className="alert-icon" />
        <div>
          <p className="alert-title">로그인이 만료되었습니다</p>
          <p>{saveError ?? '계속 저장하려면 같은 계정으로 다시 로그인하세요. 입력한 내용은 화면에 남아 있습니다.'}</p>
          <button type="button" className="button button-small button-primary" disabled={busy} onClick={run(session.reauth)}>
            다시 로그인
          </button>
        </div>
      </div>
    )
  }
  if (syncStatus === 'conflict') {
    return (
      <div className="alert alert-warning" role="alert">
        <AlertTriangle aria-hidden="true" size={18} className="alert-icon" />
        <div>
          <p className="alert-title">다른 기기에서 데이터가 바뀌었습니다</p>
          <p>{saveError} 덮어쓰기 전에 마이페이지에서 JSON 백업을 내려받을 수 있습니다.</p>
          <div className="button-row">
            <button type="button" className="button button-small" disabled={busy} onClick={run(session.reload)}>
              <RefreshCw aria-hidden="true" size={14} />
              다른 기기 데이터 불러오기 (이 화면의 저장 안 된 변경 버림)
            </button>
            <button type="button" className="button button-small button-danger" disabled={busy} onClick={run(session.forceSave)}>
              내 데이터로 덮어쓰기
            </button>
          </div>
        </div>
      </div>
    )
  }
  return null
}
