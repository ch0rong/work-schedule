import { useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { useAppState } from '../../app/storeContext'
import { useHolidays } from '../../app/useHolidays'
import { mealOccurrenceDates } from '../../features/meal/mealService'
import { toDateString } from '../../lib/date'
import type { Entry } from '../../lib/schema'
import { EntryDialog, type EntryDialogTarget } from '../schedule/EntryDialog'
import { DayEntryList } from '../schedule/DayEntryList'
import { WorkBulkDialog } from '../schedule/DutyBulkDialog'
import { SummaryCards } from '../summary/SummaryCards'
import { TodoList } from '../todo/TodoList'
import { MealPanel } from './MealPanel'
import { ScheduleCalendar, type VisibleRange } from './ScheduleCalendar'
import { TravelPanel } from './TravelPanel'

export function CalendarPage() {
  const { data } = useAppState()
  const { map: holidays } = useHolidays()
  const today = toDateString(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [range, setRange] = useState<VisibleRange>({ viewType: data.settings.defaultView, currentStart: today })
  const [dialog, setDialog] = useState<EntryDialogTarget | null>(null)
  const [mealPanel, setMealPanel] = useState<{ month: string; focusDate?: string } | null>(null)
  const [travelMonth, setTravelMonth] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const mealDates = useMemo(() => new Set(mealOccurrenceDates(data).keys()), [data])

  // 월간 보기: 보고 있는 달, 주간 보기: 선택 날짜가 그 주에 있으면 그 달
  const month = (range.viewType === 'timeGridWeek' && selectedDate >= range.currentStart ? selectedDate : range.currentStart).slice(0, 7)
  const openEntry = (entry: Entry) => setDialog({ mode: 'view', entryId: entry.id })

  return (
    <div className="calendar-page">
      {data.entries.length === 0 && (
        <div className="empty-state">
          <p className="alert-title">처음 오셨나요?</p>
          <p>
            먼저 <strong>마이페이지</strong>에서 적용 규정, 급여·공제, 입사일을 입력하세요. 그다음 달력에서 날짜를 눌러 근무·연장근무·휴가·출장을
            등록하면 요약이 채워집니다.
          </p>
        </div>
      )}

      <SummaryCards
        month={month}
        today={today}
        onOpenMeal={() => setMealPanel({ month })}
        onOpenTravel={() => setTravelMonth(month)}
      />

      <div className="calendar-layout">
        <ScheduleCalendar
          data={data}
          selectedDate={selectedDate}
          holidays={holidays}
          mealDates={mealDates}
          dayNotes={data.dayNotes}
          onRangeChange={setRange}
          onDateClick={(date) => setSelectedDate(date)}
          onEventClick={(entryId) => setDialog({ mode: 'view', entryId })}
        />

        <div className="stack calendar-side">
          <button type="button" className="button" onClick={() => setBulkOpen(true)}>
            <CalendarRange aria-hidden="true" size={18} />
            일괄 등록
          </button>
          <div className="field date-jump">
            <label htmlFor="selected-date">날짜 선택</label>
            <input id="selected-date" type="date" value={selectedDate} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} />
          </div>
          <DayEntryList
            date={selectedDate}
            onAdd={(kind) => setDialog({ mode: 'create', date: selectedDate, kind })}
            onSelectEntry={openEntry}
            onOpenMeal={(date) => setMealPanel({ month: date.slice(0, 7), focusDate: date })}
          />
        </div>

        <div className="calendar-todo">
          <TodoList />
        </div>
      </div>

      <EntryDialog target={dialog} onClose={() => setDialog(null)} />
      <WorkBulkDialog open={bulkOpen} initialMonth={month} onClose={() => setBulkOpen(false)} />
      <MealPanel key={mealPanel ? `${mealPanel.month}-${mealPanel.focusDate ?? ''}` : 'closed'} month={mealPanel?.month ?? null} focusDate={mealPanel?.focusDate} onClose={() => setMealPanel(null)} />
      <TravelPanel
        month={travelMonth}
        onClose={() => setTravelMonth(null)}
        onSelectEntry={(entry) => {
          setTravelMonth(null)
          openEntry(entry)
        }}
      />
    </div>
  )
}
