import { Plus } from 'lucide-react'
import { createId } from '../../features/schedules/scheduleService'
import type { Settings } from '../../lib/schema'
import { SettingsSection } from './SettingsSection'

/** 특별휴가 유형은 일정에서 참조할 수 있으므로 삭제 대신 숨긴다. */
export function SpecialLeaveTypes() {
  return (
    <SettingsSection<Settings['specialLeaveTypes']>
      id="special-leave"
      title="특별휴가 유형"
      description="특별휴가는 연차에서 차감하지 않습니다. 회사 기준에 맞게 유형을 추가·수정하세요."
      pick={(data) => data.settings.specialLeaveTypes}
      apply={(data, draft) => ({ ...data, settings: { ...data.settings, specialLeaveTypes: draft } })}
    >
      {(draft, set) => (
        <>
          {draft.map((type) => (
            <div key={type.id} className="inline-row">
              <input
                aria-label="특별휴가명"
                value={type.name}
                onChange={(e) => set(draft.map((item) => (item.id === type.id ? { ...item, name: e.target.value } : item)))}
              />
              <label className="checkbox nowrap">
                <input
                  type="checkbox"
                  checked={type.archived}
                  onChange={(e) => set(draft.map((item) => (item.id === type.id ? { ...item, archived: e.target.checked } : item)))}
                />
                숨김
              </label>
            </div>
          ))}
          <div>
            <button type="button" className="button button-small" onClick={() => set([...draft, { id: createId(), name: '새 특별휴가', archived: false }])}>
              <Plus aria-hidden="true" size={16} />
              유형 추가
            </button>
          </div>
        </>
      )}
    </SettingsSection>
  )
}
