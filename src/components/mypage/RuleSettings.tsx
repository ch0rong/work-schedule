import type { AppData, Settings } from '../../lib/schema'
import { CheckboxField, MoneyField, NumberField, SettingsSection, TimeField } from './SettingsSection'

const withSettings = <K extends keyof Settings>(key: K) => ({
  pick: (data: AppData) => data.settings[key],
  apply: (data: AppData, draft: Settings[K]) => ({ ...data, settings: { ...data.settings, [key]: draft } }),
})

export function RegulationSettings() {
  return (
    <SettingsSection
      id="regulation"
      title="적용 규정"
      description="선택한 규정에 따라 연차 자동 부여 참고값이 바뀝니다. 외출·조퇴 차감 여부는 아래 연차 부여 기준에서 따로 정합니다."
      {...withSettings('regulation')}
    >
      {(draft, set) => (
        <fieldset className="field">
          <legend className="visually-hidden">적용 규정</legend>
          <label className="checkbox">
            <input type="radio" name="regulation" checked={draft === 'public-servant'} onChange={() => set('public-servant')} />
            공무원·공공기관 복무규정 — 재직기간별 연가일수표
          </label>
          <label className="checkbox">
            <input type="radio" name="regulation" checked={draft === 'labor-standards'} onChange={() => set('labor-standards')} />
            근로기준법 — 1년 이상 15일(3년 이상 2년마다 +1, 최대 25일)
          </label>
        </fieldset>
      )}
    </SettingsSection>
  )
}

export function ScheduleSettings() {
  return (
    <SettingsSection id="schedule" title="근무 기본시간" description="일정에서 근무 유형을 고르면 이 시간이 자동으로 입력됩니다. 일정마다 직접 고칠 수 있습니다." {...withSettings('schedule')}>
      {(draft, set) => {
        const shift = (key: 'regular' | 'weekdayDuty' | 'weekendDuty', label: string) => (
          <fieldset className="field">
            <legend>{label}</legend>
            <div className="field-row">
              <TimeField id={`${key}-start`} label="시작" value={draft[key].start} onChange={(start) => set({ ...draft, [key]: { ...draft[key], start } })} />
              <TimeField id={`${key}-end`} label="종료" value={draft[key].end} onChange={(end) => set({ ...draft, [key]: { ...draft[key], end } })} />
              <NumberField
                id={`${key}-break`}
                label="휴게(분)"
                step={30}
                value={draft[key].breakMinutes}
                onChange={(value) => set({ ...draft, [key]: { ...draft[key], breakMinutes: value ?? Number.NaN } })}
              />
            </div>
          </fieldset>
        )
        return (
          <>
            {shift('regular', '평일 정규 근무')}
            {shift('weekdayDuty', '평일 당직')}
            {shift('weekendDuty', '주말 당직')}
            <fieldset className="field">
              <legend>유연근무 (종료 = 시작 + 실근무 + 점심)</legend>
              <div className="field-row">
                <NumberField
                  id="flex-net"
                  label="실근무(시간)"
                  step={0.5}
                  value={draft.flex.netMinutes / 60}
                  onChange={(value) => set({ ...draft, flex: { ...draft.flex, netMinutes: Math.round((value ?? Number.NaN) * 60) } })}
                />
                <NumberField
                  id="flex-break"
                  label="점심(분)"
                  step={30}
                  value={draft.flex.breakMinutes}
                  onChange={(value) => set({ ...draft, flex: { ...draft.flex, breakMinutes: value ?? Number.NaN } })}
                />
              </div>
            </fieldset>
          </>
        )
      }}
    </SettingsSection>
  )
}

type OvertimeDraft = Pick<Settings, 'overtime' | 'holidayWork'>

export function OvertimeSettings() {
  return (
    <SettingsSection<OvertimeDraft>
      id="overtime"
      title="연장근무·휴일근무"
      pick={(data) => ({ overtime: data.settings.overtime, holidayWork: data.settings.holidayWork })}
      apply={(data, draft) => ({ ...data, settings: { ...data.settings, ...draft } })}
    >
      {(draft, set) => {
        const overtime = (patch: Partial<Settings['overtime']>) => set({ ...draft, overtime: { ...draft.overtime, ...patch } })
        return (
          <>
            <div className="field-grid">
              <MoneyField id="ot-rate" label="시간당 수당(원)" value={draft.overtime.hourlyRate} onChange={(v) => overtime({ hourlyRate: v ?? Number.NaN })} />
              <NumberField id="ot-unit" label="입력 단위(분)" value={draft.overtime.unitMinutes} min={1} onChange={(v) => overtime({ unitMinutes: v ?? Number.NaN })} />
              <NumberField
                id="ot-start"
                label="수당 산정 기간 시작일"
                min={1}
                value={draft.overtime.periodStartDay}
                onChange={(v) => overtime({ periodStartDay: v ?? Number.NaN })}
                hint={`매월 ${draft.overtime.periodStartDay}일 ~ 다음 달 ${draft.overtime.periodStartDay - 1 || '말'}일 (수당 지급 기준)`}
              />
              <NumberField
                id="ot-cap"
                label="월 한도(시간)"
                step={0.5}
                value={draft.overtime.capMinutes / 60}
                onChange={(v) => overtime({ capMinutes: Math.round((v ?? Number.NaN) * 60) })}
                hint="연장근무 산정 기간 기준. 넘으면 저장할 수 없습니다"
              />
              <NumberField
                id="ot-weekly-cap"
                label="주 한도(시간)"
                step={0.5}
                value={draft.overtime.weeklyCapMinutes / 60}
                onChange={(v) => overtime({ weeklyCapMinutes: Math.round((v ?? Number.NaN) * 60) })}
                hint="월요일 ~ 일요일. 넘으면 저장할 수 없습니다"
              />
              <NumberField
                id="hw-hours"
                label="휴일 8시간 근무 수당 인정 시간"
                step={0.5}
                value={draft.holidayWork.allowanceMinutes / 60}
                onChange={(v) => set({ ...draft, holidayWork: { ...draft.holidayWork, allowanceMinutes: Math.round((v ?? Number.NaN) * 60) } })}
                hint="8시간 근무 후 수당 선택 시: 이 시간 × 시간당 수당. 8시간 미만은 실근무 × 시간당 수당"
              />
            </div>
            <CheckboxField
              label="휴일 8시간 근무 수당 시간도 월·주 한도에 포함 (8시간 미만 근무 수당은 항상 포함)"
              checked={draft.overtime.holidayAllowanceCountsTowardCap}
              onChange={(checked) => overtime({ holidayAllowanceCountsTowardCap: checked })}
            />
          </>
        )
      }}
    </SettingsSection>
  )
}

export function MealSettings() {
  return (
    <SettingsSection
      id="meal"
      title="매식비"
      description="정규근무 종료 후 연장근무가 기준 이상인 날, 또는 휴일근무 실근무가 기준 이상인 날 1건 발생합니다. 기관 지침에 맞게 조정하세요."
      {...withSettings('meal')}
    >
      {(draft, set) => (
        <>
          <NumberField
            id="meal-min"
            label="발생 기준: 종료 후 연장근무(분)"
            step={30}
            value={draft.minOvertimeMinutes}
            onChange={(v) => set({ ...draft, minOvertimeMinutes: v ?? Number.NaN })}
          />
          <NumberField
            id="meal-holiday"
            label="발생 기준: 휴일근무 실근무(시간)"
            step={0.5}
            value={draft.holidayMinWorkMinutes / 60}
            onChange={(v) => set({ ...draft, holidayMinWorkMinutes: Math.round((v ?? Number.NaN) * 60) })}
          />
          <CheckboxField label="남은 매식비를 다음 달에 사용 허용" checked={draft.allowCarryOver} onChange={(allowCarryOver) => set({ ...draft, allowCarryOver })} />
        </>
      )}
    </SettingsSection>
  )
}

export function TravelSettings() {
  return (
    <SettingsSection
      id="travel"
      title="출장비"
      description="금액을 비워 두면 '설정 필요'로 표시하고 계산하지 않습니다. 출장비는 급여 실수령액에 포함하지 않습니다."
      {...withSettings('travel')}
    >
      {(draft, set) => {
        const hours = draft.thresholdMinutes / 60
        const rate = (type: 'inside' | 'outside', label: string) => (
          <fieldset className="field">
            <legend>{label}</legend>
            <div className="field-row">
              {(['under', 'over'] as const).map((key) => (
                <MoneyField
                  key={key}
                  id={`travel-${type}-${key}`}
                  label={`${hours}시간 ${key === 'under' ? '미만' : '이상'}(원)`}
                  nullable
                  value={draft[type][key]}
                  onChange={(v) => set({ ...draft, [type]: { ...draft[type], [key]: v } })}
                />
              ))}
              <MoneyField
                id={`travel-${type}-cap`}
                label="일일 최대(원)"
                value={draft[type].dailyCap}
                onChange={(v) => set({ ...draft, [type]: { ...draft[type], dailyCap: v ?? Number.NaN } })}
              />
            </div>
          </fieldset>
        )
        return (
          <>
            <NumberField
              id="travel-threshold"
              label="시간 기준(시간)"
              step={0.5}
              value={hours}
              onChange={(v) => set({ ...draft, thresholdMinutes: Math.round((v ?? Number.NaN) * 60) })}
            />
            {rate('inside', '관내')}
            {rate('outside', '관외 (관외 출장이 있는 날은 관외 일일 최대 적용)')}
          </>
        )
      }}
    </SettingsSection>
  )
}

export function CompLeaveSettings() {
  return (
    <SettingsSection
      id="comp"
      title="대체휴무"
      description="주말 당직은 항상, 휴일근무는 '대체휴무'·'출장'을 선택했을 때 1회당 1일 발생하며, 반일·시간 단위로 나눠 쓸 수 있습니다. 사용 기한이 지나도 자동 소멸하지 않고 경고만 표시합니다."
      {...withSettings('compLeave')}
    >
      {(draft, set) => (
        <div className="field-grid">
          <NumberField id="comp-months" label="사용 기한(개월)" min={1} value={draft.validityMonths} onChange={(v) => set({ ...draft, validityMonths: v ?? Number.NaN })} />
        </div>
      )}
    </SettingsSection>
  )
}

export function LeaveBasisSettings() {
  return (
    <SettingsSection
      id="leave-basis"
      title="연차 부여 기준"
      description="자동 계산값은 참고값입니다. 회사가 실제로 부여한 일수는 '연차·대체휴무' 화면에서 직접 입력하세요."
      {...withSettings('leave')}
      validate={(draft) => (draft.basis === 'hire-date' && !draft.hireDate ? ['입사일 기준을 쓰려면 입사일을 입력하세요.'] : [])}
    >
      {(draft, set) => (
        <>
          <fieldset className="field">
            <legend>부여 기준</legend>
            <label className="checkbox">
              <input type="radio" name="leave-basis" checked={draft.basis === 'fiscal-year'} onChange={() => set({ ...draft, basis: 'fiscal-year' })} />
              회계연도 (매년 1월 1일)
            </label>
            <label className="checkbox">
              <input type="radio" name="leave-basis" checked={draft.basis === 'hire-date'} onChange={() => set({ ...draft, basis: 'hire-date' })} />
              입사일 기준 (입사 기념일부터 1년)
            </label>
          </fieldset>
          <div className="field-row">
            <div className="field">
              <label htmlFor="hire-date">입사일</label>
              <input id="hire-date" type="date" value={draft.hireDate ?? ''} onChange={(e) => set({ ...draft, hireDate: e.target.value || null })} />
            </div>
            <NumberField
              id="minutes-per-day"
              label="연차 1일 = (시간)"
              step={0.5}
              value={draft.minutesPerDay / 60}
              onChange={(v) => set({ ...draft, minutesPerDay: Math.round((v ?? Number.NaN) * 60) })}
              hint="반차는 이 시간의 절반"
            />
          </div>
          <CheckboxField
            label="외출·조퇴를 연차에서 차감 (누계 1일분 = 연차 1일)"
            checked={draft.outingDeducts}
            onChange={(outingDeducts) => set({ ...draft, outingDeducts })}
          />
          <CheckboxField label="공가를 연차에서 차감" checked={draft.officialDeducts} onChange={(officialDeducts) => set({ ...draft, officialDeducts })} />
          <CheckboxField label="병가를 연차에서 차감" checked={draft.sickDeducts} onChange={(sickDeducts) => set({ ...draft, sickDeducts })} />

          <details>
            <summary>공무원 재직기간별 연가일수표 (국가공무원 복무규정 제15조, 2024년 개정 반영)</summary>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">재직기간 (이상)</th>
                    <th scope="col">연가일수</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.publicServantTable.map((row, index) => (
                    <tr key={index}>
                      <td>
                        {row.minMonths >= 12 ? `${row.minMonths / 12}년` : `${row.minMonths}개월`}
                      </td>
                      <td>
                        <input
                          type="number"
                          aria-label={`재직 ${row.minMonths}개월 이상 연가일수`}
                          className="table-input"
                          min={0}
                          value={Number.isNaN(row.days) ? '' : row.days}
                          onChange={(e) =>
                            set({
                              ...draft,
                              publicServantTable: draft.publicServantTable.map((item, i) =>
                                i === index ? { ...item, days: e.target.value === '' ? Number.NaN : Number(e.target.value) } : item,
                              ),
                            })
                          }
                        />
                        일
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </SettingsSection>
  )
}

export function SessionSettings() {
  return (
    <SettingsSection id="session" title="로그인 세션" description="로그인 연동(9단계) 후 적용됩니다." {...withSettings('session')}>
      {(draft, set) => (
        <NumberField
          id="idle-logout"
          label="자동 로그아웃(분, 사용하지 않을 때)"
          min={5}
          value={draft.idleLogoutMinutes}
          onChange={(v) => set({ idleLogoutMinutes: v ?? Number.NaN })}
        />
      )}
    </SettingsSection>
  )
}
