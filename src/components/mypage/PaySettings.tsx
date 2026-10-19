import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { DEDUCTION_BASE_LABELS, formatWon, LEGACY_TAX_DEDUCTION_IDS } from '../../features/pay/payService'
import { TAX_TABLE } from '../../lib/taxTable'
import { createId } from '../../features/schedules/scheduleService'
import { toDateString } from '../../lib/date'
import type { Deduction, PayProfile, Settings } from '../../lib/schema'
import { MoneyInput } from '../common/MoneyInput'
import { MoneyField, NumberField, SettingsSection } from './SettingsSection'

type PayDraft = Settings['pay']

export function PaySettings() {
  const thisMonth = toDateString(new Date()).slice(0, 7)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newMonth, setNewMonth] = useState(thisMonth)

  return (
    <SettingsSection<PayDraft>
      id="pay"
      title="급여·공제"
      description="입력한 금액·요율로 예상 실수령액을 계산합니다. 4대보험 요율은 임의로 넣지 않으니 급여명세서를 보고 입력하세요. 소득세·지방소득세는 아래 '세금' 설정으로 자동 계산합니다."
      pick={(data) => data.settings.pay}
      apply={(data, draft) => ({ ...data, settings: { ...data.settings, pay: draft } })}
    >
      {(draft, set) => {
        const profiles = [...draft.profiles].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
        const profile = profiles.find((item) => item.id === selectedId) ?? profiles[profiles.length - 1]
        const update = (patch: Partial<PayProfile>) =>
          set({ ...draft, profiles: draft.profiles.map((item) => (item.id === profile.id ? { ...item, ...patch } : item)) })
        const updateDeduction = (id: string, patch: Partial<Deduction>) =>
          update({ deductions: profile.deductions.map((item) => (item.id === id ? { ...item, ...patch } : item)) })

        return (
          <>
            <div className="field-row">
              <NumberField
                id="payday"
                label="급여일 (매월)"
                min={1}
                value={draft.payday}
                onChange={(v) => set({ ...draft, payday: v ?? Number.NaN })}
                hint="주말·공휴일이면 직전 영업일에 지급"
              />
              <div className="field">
                <label htmlFor="rounding">요율 공제 금액 처리</label>
                <select id="rounding" value={draft.rounding} onChange={(e) => set({ ...draft, rounding: e.target.value as PayDraft['rounding'] })}>
                  <option value="round">원 단위 반올림</option>
                  <option value="floor10">10원 미만 절사</option>
                </select>
              </div>
            </div>

            <fieldset className="field">
              <legend>적용 시작 월별 급여 설정 (급여가 바뀌면 새 적용 월을 추가해 과거 월 계산을 유지)</legend>
              <div className="button-row">
                {profiles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="button button-small"
                    aria-pressed={item.id === profile.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {item.effectiveFrom}부터
                  </button>
                ))}
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="new-profile-month">새 적용 시작 월</label>
                  <input id="new-profile-month" type="month" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
                </div>
                <div className="field align-end">
                  <button
                    type="button"
                    className="button"
                    disabled={!newMonth || draft.profiles.some((item) => item.effectiveFrom === newMonth)}
                    onClick={() => {
                      const copy: PayProfile = { ...structuredClone(profile), id: createId(), effectiveFrom: newMonth }
                      set({ ...draft, profiles: [...draft.profiles, copy] })
                      setSelectedId(copy.id)
                    }}
                  >
                    <Plus aria-hidden="true" size={16} />
                    현재 설정 복사해 추가
                  </button>
                </div>
              </div>
            </fieldset>

            <div className="subcard">
              <div className="card-header">
                <h4 className="subsection-title">{profile.effectiveFrom}부터 적용</h4>
                {draft.profiles.length > 1 && (
                  <button
                    type="button"
                    className="button button-small button-danger"
                    onClick={() => {
                      set({ ...draft, profiles: draft.profiles.filter((item) => item.id !== profile.id) })
                      setSelectedId(null)
                    }}
                  >
                    이 적용 월 설정 삭제
                  </button>
                )}
              </div>

              <MoneyField id="base-salary" label="기본급(원)" value={profile.baseSalary} onChange={(v) => update({ baseSalary: v ?? Number.NaN })} />

              <fieldset className="field">
                <legend>지급 항목 (교통비·식비·기타 수당) — 비과세 항목은 체크</legend>
                {profile.items.map((item) => (
                  <div key={item.id} className="inline-row">
                    <input
                      aria-label="항목명"
                      value={item.name}
                      onChange={(e) => update({ items: profile.items.map((x) => (x.id === item.id ? { ...x, name: e.target.value } : x)) })}
                    />
                    <MoneyInput
                      aria-label={`${item.name} 금액(원)`}
                      value={item.amount}
                      onChange={(amount) => update({ items: profile.items.map((x) => (x.id === item.id ? { ...x, amount: amount ?? Number.NaN } : x)) })}
                    />
                    <span className="muted small nowrap">원</span>
                    <label className="checkbox nowrap small">
                      <input
                        type="checkbox"
                        checked={item.taxFree}
                        onChange={(e) => update({ items: profile.items.map((x) => (x.id === item.id ? { ...x, taxFree: e.target.checked } : x)) })}
                      />
                      비과세
                    </label>
                    <button
                      type="button"
                      className="button button-small button-danger"
                      aria-label={`${item.name} 삭제`}
                      onClick={() => update({ items: profile.items.filter((x) => x.id !== item.id) })}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </div>
                ))}
                <div>
                  <button type="button" className="button button-small" onClick={() => update({ items: [...profile.items, { id: createId(), name: '수당', amount: 0, taxFree: false }] })}>
                    <Plus aria-hidden="true" size={16} />
                    지급 항목 추가
                  </button>
                </div>
              </fieldset>

              <fieldset className="field">
                <legend>공제 항목 (4대보험·기타) — 금액 또는 요율</legend>
                <p className="hint">소득세·지방소득세는 간이세액표로 자동 계산하므로 여기에 넣지 않습니다.</p>
                {/* 예전 소득세·지방소득세 직접 입력 항목은 값은 보존하고 화면에서만 숨긴다 */}
                {profile.deductions.filter((item) => !LEGACY_TAX_DEDUCTION_IDS.includes(item.id)).map((item) => (
                  <div key={item.id} className="deduction-row">
                    <input
                      aria-label="공제 항목명"
                      value={item.name}
                      onChange={(e) => updateDeduction(item.id, { name: e.target.value })}
                    />
                    <select aria-label={`${item.name} 계산 방식`} value={item.method} onChange={(e) => updateDeduction(item.id, { method: e.target.value as Deduction['method'] })}>
                      <option value="amount">금액(원)</option>
                      <option value="rate">요율(%)</option>
                    </select>
                    {item.method === 'rate' ? (
                      <input
                        aria-label={`${item.name} 요율(%)`}
                        type="number"
                        min={0}
                        step={0.001}
                        value={Number.isNaN(item.value) ? '' : item.value}
                        onChange={(e) => updateDeduction(item.id, { value: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                      />
                    ) : (
                      <MoneyInput
                        aria-label={`${item.name} 금액(원)`}
                        value={item.value}
                        onChange={(value) => updateDeduction(item.id, { value: value ?? Number.NaN })}
                      />
                    )}
                    {item.method === 'rate' ? (
                      <select aria-label={`${item.name} 요율 기준`} value={item.base} onChange={(e) => updateDeduction(item.id, { base: e.target.value })}>
                        {Object.entries(DEDUCTION_BASE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            × {label}
                          </option>
                        ))}
                        {profile.deductions
                          .filter((other) => other.id !== item.id && !LEGACY_TAX_DEDUCTION_IDS.includes(other.id))
                          .map((other) => (
                            <option key={other.id} value={`deduction:${other.id}`}>
                              × {other.name} 공제액
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className="muted small">{formatWon(Number.isNaN(item.value) ? 0 : item.value)}</span>
                    )}
                    <button
                      type="button"
                      className="button button-small button-danger"
                      aria-label={`${item.name} 삭제`}
                      onClick={() => update({ deductions: profile.deductions.filter((x) => x.id !== item.id) })}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => update({ deductions: [...profile.deductions, { id: createId(), name: '기타 공제', method: 'amount', value: 0, base: 'base-salary' }] })}
                  >
                    <Plus aria-hidden="true" size={16} />
                    공제 항목 추가
                  </button>
                </div>
              </fieldset>
            </div>
          </>
        )
      }}
    </SettingsSection>
  )
}

/** 소득세(간이세액표) 계산 기준: 공제대상 가족 수, 8~20세 자녀 수 */
export function TaxSettings() {
  return (
    <SettingsSection<Settings['tax']>
      id="tax"
      title="세금 (소득세·지방소득세)"
      description={`국세청 근로소득 간이세액표(${TAX_TABLE.effectiveFrom} 시행)로 월 과세급여(비과세 항목 제외)에 대한 소득세를 찾고, 지방소득세는 소득세의 10%(10원 미만 절사)로 계산합니다. 예상치입니다.`}
      pick={(data) => data.settings.tax}
      apply={(data, draft) => ({ ...data, settings: { ...data.settings, tax: draft } })}
    >
      {(draft, set) => (
        <div className="field-grid">
          <NumberField
            id="tax-family"
            label="공제대상 부양가족 수 (본인 포함)"
            min={1}
            value={draft.familyCount}
            onChange={(v) => set({ ...draft, familyCount: v ?? Number.NaN })}
            hint="본인 1명, 배우자도 1명으로 셉니다"
          />
          <NumberField
            id="tax-children"
            label="8세 이상 20세 이하 자녀 수"
            min={0}
            value={draft.childCount}
            onChange={(v) => set({ ...draft, childCount: v ?? Number.NaN })}
            hint="공제대상 가족 중 해당 자녀 수. 1명 20,830원, 2명 45,830원, 3명부터 1명당 33,330원을 소득세에서 뺍니다"
          />
        </div>
      )}
    </SettingsSection>
  )
}
