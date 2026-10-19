import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import type { AppData } from '../../lib/schema'
import { ErrorMessage } from '../common/ErrorMessage'
import { MoneyInput } from '../common/MoneyInput'
import { TimeSelect } from '../common/TimeSelect'
import { useReportUnsaved } from './unsavedContext'

interface SettingsSectionProps<T> {
  id: string
  title: string
  description?: ReactNode
  /** 저장된 데이터에서 편집할 값 */
  pick: (data: AppData) => T
  /** 편집한 값을 데이터에 반영 */
  apply: (data: AppData, draft: T) => AppData
  /** 저장 전 추가 검증. 오류 메시지 목록 */
  validate?: (draft: T) => string[]
  children: (draft: T, setDraft: (next: T) => void) => ReactNode
}

/**
 * 마이페이지 설정 카드. 값을 바꾼 뒤 [저장]을 눌러야 반영된다.
 * 저장할 때 전체 데이터 스키마로 검증하므로 잘못된 값은 저장되지 않는다.
 */
export function SettingsSection<T>({ id, title, description, pick, apply, validate, children }: SettingsSectionProps<T>) {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()
  const [draft, setDraft] = useState<T>(() => pick(data))
  const [errors, setErrors] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const reportUnsaved = useReportUnsaved()

  useEffect(() => {
    reportUnsaved(id, dirty)
    return () => reportUnsaved(id, false)
  }, [id, dirty, reportUnsaved])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const extra = validate?.(draft) ?? []
    if (extra.length > 0) {
      setErrors(extra)
      return
    }
    const result = store.update((current) => apply(current, draft))
    if (!result.ok) {
      setErrors(result.errors.map((message) => message.replace(/expected number, received NaN/i, '숫자를 입력하세요.')))
      return
    }
    setErrors([])
    setDirty(false)
    notify(`${title} 설정을 저장했습니다.`)
  }

  return (
    <form className="card" onSubmit={handleSubmit} noValidate aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="section-title">
        {title}
      </h3>
      {description && <div className="muted small">{description}</div>}
      {children(draft, (next) => {
        setDraft(next)
        setDirty(true)
      })}
      {errors.length > 0 && <ErrorMessage title="저장하지 못했습니다." messages={errors} />}
      <div className="button-row">
        <button type="submit" className="button button-primary" disabled={!dirty}>
          저장
        </button>
        {dirty && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setDraft(pick(data))
              setDirty(false)
              setErrors([])
            }}
          >
            되돌리기
          </button>
        )}
      </div>
    </form>
  )
}

/** 숫자 입력. 빈 값은 NaN으로 넘겨 저장 시 검증에서 걸러진다. */
export function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  step = 1,
  min = 0,
  nullable = false,
}: {
  id: string
  label: string
  value: number | null
  onChange: (value: number | null) => void
  hint?: string
  step?: number
  min?: number
  nullable?: boolean
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value === null || Number.isNaN(value) ? '' : value}
        placeholder={nullable ? '미정' : undefined}
        onChange={(e) => onChange(e.target.value === '' ? (nullable ? null : Number.NaN) : Number(e.target.value))}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  )
}

/** 금액 입력 (천 단위 쉼표). 빈 값은 nullable이면 null, 아니면 NaN으로 넘겨 저장 시 검증에서 걸러진다. */
export function MoneyField({
  id,
  label,
  value,
  onChange,
  hint,
  nullable = false,
}: {
  id: string
  label: string
  value: number | null
  onChange: (value: number | null) => void
  hint?: string
  nullable?: boolean
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <MoneyInput
        id={id}
        value={value}
        placeholder={nullable ? '미정' : undefined}
        onChange={(next) => onChange(next === null ? (nullable ? null : Number.NaN) : next)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  )
}

export function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <TimeSelect id={id} label={label} value={value} onChange={onChange} />
    </div>
  )
}

export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
