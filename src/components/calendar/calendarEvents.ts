import type { EventInput } from '@fullcalendar/react'
import { LEAVE_COLORS } from '../../features/leave/leaveService'
import { overtimeMinutes } from '../../features/overtime/overtimeService'
import { entryTitle, readableTextColor } from '../../features/schedules/scheduleService'
import { addDaysToDateString } from '../../lib/date'
import type { AppData } from '../../lib/schema'

const FALLBACK_COLOR = '#8A8F98'
const TRIP_COLOR = '#8D6E4A'

/** `+1:30` 형식 */
function shortDuration(minutes: number): string {
  return `+${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * 저장된 일정을 FullCalendar 이벤트로 바꾼다.
 * 색상과 함께 텍스트 라벨(유형명)을 항상 표시하고, 연장근무는 근무 라벨에 `+1:30`처럼 붙인다(휴일근무 제외).
 */
export function toCalendarEvents(data: AppData): EventInput[] {
  const typeById = new Map(data.workTypes.map((type) => [type.id, type]))

  return data.entries.map((entry) => {
    const title = entryTitle(entry, data)
    if (entry.kind === 'leave') {
      const color = LEAVE_COLORS[entry.leaveType]
      const timed = entry.startTime !== null && entry.endTime !== null
      return {
        id: entry.id,
        title,
        start: timed ? `${entry.date}T${entry.startTime}` : entry.date,
        // 종일 이벤트의 end는 다음 날 0시(배타적)
        end: timed ? `${entry.date}T${entry.endTime}` : addDaysToDateString(entry.endDate, 1),
        allDay: !timed,
        color,
        contrastColor: readableTextColor(color),
        className: 'event-leave',
      }
    }
    if (entry.kind === 'trip') {
      return {
        id: entry.id,
        title,
        start: `${entry.date}T${entry.startTime}`,
        end: `${entry.date}T${entry.endTime}`,
        allDay: false,
        color: TRIP_COLOR,
        contrastColor: readableTextColor(TRIP_COLOR),
        className: 'event-trip',
      }
    }
    const type = typeById.get(entry.workTypeId)
    const color = type?.color ?? FALLBACK_COLOR
    // 휴일근무는 연장근무를 인정하지 않는다
    const overtime = type?.category === 'holiday-work' ? 0 : overtimeMinutes(entry)
    return {
      id: entry.id,
      title: overtime > 0 ? `${title} ${shortDuration(overtime)}` : title,
      start: `${entry.date}T${entry.startTime}`,
      end: `${entry.endDate}T${entry.endTime}`,
      allDay: false,
      color,
      contrastColor: readableTextColor(color),
      className: type?.countsAsWork === false ? 'event-off' : 'event-work',
    }
  })
}
