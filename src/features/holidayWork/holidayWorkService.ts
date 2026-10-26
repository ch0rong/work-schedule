import type { HolidayCompensation, Settings, WorkEntry } from '../../lib/schema'
import { calculateNetMinutes } from '../../lib/time'

/**
 * 휴일근무 인정 기준 (2026-10-19 사용자 확정, 회사 규정)
 * - 실근무 = 종료 − 시작 − 사용자가 입력한 휴게시간
 * - 최대 8시간까지만 인정. 넘는 시간은 버린다(연장 수당 없음)
 * - 8시간 이상: 대체휴무 1일 / 수당 지급(인정 시간 설정값, 기본 7.5시간) / 출장(대체휴무) 중 선택
 * - 8시간 미만(7.5시간 포함): 대체휴무 불가, 무조건 수당 = 실근무 × 시간당 수당
 * - 시간 단위로 보상받는 수당 시간은 항상 월(산정 기간)·주 연장 한도에 포함 (2026-10-26 사용자 확정)
 */
export const HOLIDAY_WORK_FULL_DAY_MINUTES = 8 * 60

export interface HolidayWorkResult {
  /** 실근무 (휴게 제외) */
  netMinutes: number
  /** 인정 시간 (최대 8시간) */
  recognizedMinutes: number
  /** 8시간을 넘어 인정하지 않는 시간 */
  droppedMinutes: number
  /** 8시간 이상 근무해 대체휴무·출장을 고를 수 있는지 */
  fullDay: boolean
  /** 실제 적용되는 보상 (8시간 미만이면 저장 값과 관계없이 수당) */
  compensation: HolidayCompensation
  /** 수당 산정 시간 (대체휴무·출장이면 0) */
  allowanceMinutes: number
  /** 예상 수당 = 산정 시간 × 시간당 수당 (원 단위 반올림, 연장근무 수당과 같은 식). 월·주 한도 적용 전 */
  amount: number
  /** 수당 산정 시간을 월·주 연장 한도에 넣는지 */
  countsTowardCap: boolean
  earnsCompLeave: boolean
}

type HolidayWorkInput = Pick<WorkEntry, 'startTime' | 'endTime' | 'endsNextDay' | 'breakMinutes' | 'holidayCompensation'>

export function holidayWorkResult(entry: HolidayWorkInput, settings: Settings): HolidayWorkResult {
  const netMinutes = Math.max(0, calculateNetMinutes(entry))
  const recognizedMinutes = Math.min(netMinutes, HOLIDAY_WORK_FULL_DAY_MINUTES)
  const droppedMinutes = netMinutes - recognizedMinutes
  const fullDay = netMinutes >= HOLIDAY_WORK_FULL_DAY_MINUTES
  const base = { netMinutes, recognizedMinutes, droppedMinutes, fullDay }
  const amount = (minutes: number) => Math.round((minutes * settings.overtime.hourlyRate) / 60)

  if (!fullDay) {
    // 8시간 미만: 실근무 그대로 수당, 한도 포함
    return { ...base, compensation: 'allowance', allowanceMinutes: recognizedMinutes, amount: amount(recognizedMinutes), countsTowardCap: true, earnsCompLeave: false }
  }
  const compensation = entry.holidayCompensation ?? 'comp-leave'
  if (compensation === 'allowance') {
    // 8시간 근무 + 수당 선택: 8시간이 아니라 인정 시간(기본 7.5시간)으로 지급
    return {
      ...base,
      compensation,
      allowanceMinutes: settings.holidayWork.allowanceMinutes,
      amount: amount(settings.holidayWork.allowanceMinutes),
      countsTowardCap: true,
      earnsCompLeave: false,
    }
  }
  // 대체휴무 또는 출장(대체휴무): 수당 없이 대체휴무 1일
  return { ...base, compensation, allowanceMinutes: 0, amount: 0, countsTowardCap: false, earnsCompLeave: true }
}
