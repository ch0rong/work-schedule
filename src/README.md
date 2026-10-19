# src 폴더 제안 구조

```text
src/
  app/
    App.tsx
    routes.tsx
  components/
    calendar/
      ScheduleCalendar.tsx
      CalendarToolbar.tsx
    schedule/
      ScheduleForm.tsx
      ScheduleDetails.tsx
    leave/
      LeaveForm.tsx
      LeaveSummary.tsx
    pay/
      PaySettingsForm.tsx
      PayEstimate.tsx
    common/
      ConfirmDialog.tsx
      EmptyState.tsx
      ErrorMessage.tsx
  features/
    schedules/
      scheduleService.ts
      scheduleSchema.ts
    leave/
      leaveService.ts
    pay/
      payService.ts
  lib/
    storage.ts
    backup.ts
    date.ts
    validation.ts
  types/
    schedule.ts
    settings.ts
  styles/
    global.css
  main.tsx
```

이 구조는 제안안이며, 초기 버전에서는 과도하게 쪼개지 말고 기능이 늘어날 때 분리합니다.
