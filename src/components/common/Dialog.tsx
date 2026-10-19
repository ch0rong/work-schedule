import { useEffect, useId, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** 하단 버튼 영역 */
  actions?: ReactNode
}

/**
 * 네이티브 <dialog>의 모달을 사용한다.
 * 포커스 가두기, Esc 닫기, 닫힌 뒤 원래 위치로 포커스 복귀를 브라우저가 처리한다.
 */
export function Dialog({ open, title, onClose, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      {open && (
        <>
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <div className="dialog-body">{children}</div>
          {actions && <div className="dialog-actions">{actions}</div>}
        </>
      )}
    </dialog>
  )
}
