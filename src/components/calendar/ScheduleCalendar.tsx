import { useMemo, useRef, useState } from 'react'
import FullCalendar, { type CalendarRef, type DateClickInfo, type DatesSetInfo, type EventClickInfo } from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import interactionPlugin from '@fullcalendar/react/interaction'
import koLocale from '@fullcalendar/react/locales/ko'
import classicThemePlugin from '@fullcalendar/react/themes/classic'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/classic/theme.css'
import '@fullcalendar/react/themes/classic/palette.css'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { toDateString } from '../../lib/date'
import type { Holiday } from '../../lib/holidays'
import type { AppData, Settings } from '../../lib/schema'
import { toCalendarEvents } from './calendarEvents'

export type CalendarViewType = Settings['defaultView']

export interface VisibleRange {
  viewType: CalendarViewType
  /** 현재 보기의 첫날 (월간: 1일, 주간: 주 시작일) */
  currentStart: string
}

interface ScheduleCalendarProps {
  data: AppData
  selectedDate: string
  /** 날짜별 공휴일 */
  holidays: ReadonlyMap<string, readonly Holiday[]>
  /** 매식비 발생일 */
  mealDates: ReadonlySet<string>
  /** 날짜별 메모 */
  dayNotes: Readonly<Record<string, string>>
  onDateClick: (date: string, startTime?: string) => void
  onEventClick: (entryId: string) => void
  onRangeChange: (range: VisibleRange) => void
}

const VIEW_LABELS: Record<CalendarViewType, string> = { dayGridMonth: '월간', timeGridWeek: '주간' }

export function ScheduleCalendar({ data, selectedDate, holidays, mealDates, dayNotes, onDateClick, onEventClick, onRangeChange }: ScheduleCalendarProps) {
  const ref = useRef<CalendarRef>(null)
  const [title, setTitle] = useState('')
  const [viewType, setViewType] = useState<CalendarViewType>(data.settings.defaultView)
  const events = useMemo(() => toCalendarEvents(data), [data])
  const api = () => ref.current?.getApi()

  /** 토요일·일요일 (월간 보기 요일 머리글은 요일만 본다) */
  const weekdayClass = (date: Date) => (date.getDay() === 6 ? 'is-sat' : date.getDay() === 0 ? 'is-sun' : '')
  /** 주말·공휴일·추가 휴일·선택 날짜 표시 */
  const dayClass = (date: Date, withSelection: boolean) => {
    const key = toDateString(date)
    const kinds = holidays.get(key)?.map((holiday) => holiday.kind) ?? []
    return [
      weekdayClass(date),
      withSelection && key === selectedDate && 'is-selected-day',
      kinds.some((kind) => kind !== 'custom') && 'is-holiday',
      kinds.includes('custom') && 'is-custom-holiday',
    ]
      .filter(Boolean)
      .join(' ')
  }

  function handleDatesSet(info: DatesSetInfo) {
    const type = info.view.type as CalendarViewType
    setTitle(info.view.title)
    setViewType(type)
    onRangeChange({ viewType: type, currentStart: toDateString(info.view.currentStart) })
  }

  function handleDateClick(info: DateClickInfo) {
    onDateClick(toDateString(info.date), info.allDay ? undefined : format(info.date, 'HH:mm'))
  }

  function handleEventClick(info: EventClickInfo) {
    info.jsEvent.preventDefault()
    onEventClick(info.event.id)
  }

  return (
    <section className={`calendar card view-${viewType}`} aria-label="근무 달력">
      <div className="calendar-toolbar">
        <h3 className="calendar-title" aria-live="polite">
          {title}
        </h3>
        <div className="calendar-controls">
          <div className="button-group">
            <button type="button" className="button icon-button" aria-label="이전 기간" onClick={() => api()?.prev()}>
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button type="button" className="button" onClick={() => api()?.today()}>
              오늘
            </button>
            <button type="button" className="button icon-button" aria-label="다음 기간" onClick={() => api()?.next()}>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="button-group" role="group" aria-label="달력 보기">
            {(Object.keys(VIEW_LABELS) as CalendarViewType[]).map((type) => (
              <button
                key={type}
                type="button"
                className="button"
                aria-pressed={viewType === type}
                onClick={() => api()?.changeView(type)}
              >
                {VIEW_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="calendar-scroll">
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, classicThemePlugin]}
          locale={koLocale}
          initialView={data.settings.defaultView}
          firstDay={data.settings.weekStartsOn}
          headerToolbar={false}
          height="auto"
          events={events}
          dayMaxEvents={false}
          fixedWeekCount={false}
          nowIndicator
          scrollTime="08:00:00"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayCellClass={(info) => dayClass(info.date, true)}
          dayLaneClass={(info) => dayClass(info.date, true)}
          dayHeaderClass={(info) => (info.view.type === 'timeGridWeek' ? dayClass(info.date, false) : weekdayClass(info.date))}
          dayCellTopContent={(info) => {
            const date = toDateString(info.date)
            const names = holidays.get(date)?.map((holiday) => holiday.name) ?? []
            return (
              <span className="day-top">
                <span className="day-number">{info.dayNumberText.replace('일', '')}</span>
                {names.length > 0 && <span className="day-holiday">{names.join(', ')}</span>}
                {mealDates.has(date) && <span className="day-meal">매식비</span>}
                {dayNotes[date] && (
                  <span className="day-note" title={dayNotes[date]}>
                    {dayNotes[date].split('\n')[0]}
                  </span>
                )}
              </span>
            )
          }}
          dayHeaderContent={(info) => {
            const date = toDateString(info.date)
            const names = holidays.get(date)?.map((holiday) => holiday.name) ?? []
            const isWeek = info.view.type === 'timeGridWeek'
            return (
              <span>
                {info.text}
                {isWeek && names.length > 0 && <span className="day-holiday"> {names.join(', ')}</span>}
                {isWeek && mealDates.has(date) && <span className="day-meal">매식비</span>}
              </span>
            )
          }}
          datesSet={handleDatesSet}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
        />
      </div>
    </section>
  )
}
