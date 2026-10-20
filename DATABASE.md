# 데이터 구조 설계 (v2)

서버 DB를 쓰지 않는다. 버전이 있는 JSON 문서 1개를 저장한다.
- 클라우드 모드: Google Drive appDataFolder의 `work-schedule-data.json`
- 개발·로컬 모드: localStorage 키 `work-schedule-app:v1` (키 이름은 v1과 같고 문서 안의 `schemaVersion`으로 구분)

## 공통 규칙
- 날짜 `YYYY-MM-DD`, 시간 `HH:mm`, 월 `YYYY-MM`
- 시간·연차·대체휴무는 **분 단위 정수** (1일 = `settings.leave.minutesPerDay`, 기본 480분)
- 금액은 원 단위 정수, 요율은 퍼센트 숫자(예: 4.5 = 4.5%)
- 계산 결과(연장근무 누적, 매식비 발생, 대체휴무 발생, 연차 부여 참고값, 급여)는 **저장하지 않고 일정에서 매번 계산**한다. 사용자가 직접 입력한 값만 저장한다.
  - 예외: 대체휴무 만료일(`WorkEntry.compExpiresOn`)은 사용자 요청으로 발생 일정에 기록한다. 기한 설정을 바꿔도 이미 기록된 발생 건의 기한은 바뀌지 않는다.

## 최상위 구조
```jsonc
{
  "schemaVersion": 2,
  "settings": { /* 아래 */ },
  "workTypes": [ /* WorkType */ ],
  "entries": [ /* WorkEntry | LeaveEntry | TripEntry */ ],
  "mealUsages": [ /* MealUsage */ ],
  "payrollRecords": { "2026-10": { "actualDeposit": 2850000, "note": "" } },
  "holidays": {
    "custom": [ { "id": "…", "date": "2026-10-02", "name": "임시공휴일" } ],
    "overrides": [ { "date": "2026-12-25", "originalName": "기독탄신일", "name": "성탄절" } ]   // 법정공휴일 이름 수정 (없으면 [])
  },
  "dayNotes": { "2026-10-15": "교육 참석" },   // 날짜별 메모 (일정과 별개, 없으면 {})
  "compDismissals": [ { "entryId": "…", "date": "2026-10-19" } ],   // 직접 삭제한 대체휴무 발생 건 (없으면 [])
  "legacy": { /* v1에서 대응 항목이 없던 설정 원본 (선택) */ },
  "updatedAt": "2026-10-19T00:00:00.000Z"
}
```

## settings
| 키 | 내용 | 기본값 |
|---|---|---|
| `currency`, `defaultView`, `weekStartsOn` | 통화, 기본 달력 보기, 주 시작 요일(0=일요일) | `KRW`, `dayGridMonth`, `0` |
| `regulation` | `public-servant` \| `labor-standards` | `public-servant` |
| `leave.basis` | `fiscal-year` \| `hire-date` | `fiscal-year` |
| `leave.hireDate` | 입사일 | `null` |
| `leave.minutesPerDay` | 연차 1일 분 | `480` |
| `leave.outingDeducts` | 외출·조퇴 연차 차감 (없으면 true로 읽음) | `true` |
| `leave.officialDeducts`, `leave.sickDeducts` | 공가·병가 연차 차감 | `false`, `false` |
| `leave.publicServantTable` | 공무원 재직기간별 연가일수 `[{ minMonths, days }]` | 공식 규정 값 |
| `leave.grants` | 부여 기간별 직접 입력 `{ [periodKey]: { days: number \| null, extraDays, note } }` — `days`가 null이면 자동 참고값 사용. periodKey: 회계연도 `YYYY`, 입사일 기준 기간 시작일 `YYYY-MM-DD` | `{}` |
| `schedule.regular` | 정규 근무 `{ start, end, breakMinutes }` | 09:00, 18:00, 60 |
| `schedule.weekdayDuty` | 평일 당직 | 12:30, 21:30, 60 |
| `schedule.weekendDuty` | 주말 당직 | 09:00, 18:00, 60 |
| `schedule.flex` | 유연근무 `{ netMinutes, breakMinutes }` | 480, 60 |
| `overtime.hourlyRate` | 연장근무 시간당 단가 | 18050 |
| `overtime.unitMinutes` | 입력 단위 | 30 |
| `overtime.periodStartDay` | 수당 정산 기간 시작일(이날부터 다음 달 전날까지) | 21 |
| `overtime.capMinutes` | 월(1일~말일) 한도. 넘는 입력은 저장 차단 | 1200 |
| `overtime.weeklyCapMinutes` | 주(월~일) 한도. 넘는 입력은 저장 차단 (없으면 720으로 읽음) | 720 |
| `overtime.holidayAllowanceCountsTowardCap` | 휴일근무 수당분의 월·주 한도 포함 | `false` |
| `holidayWork.allowanceMinutes` | 휴일 8시간 근무 후 수당 선택 시 인정 시간 (8시간 미만은 실근무로 계산) | 450 (7.5시간) |
| `compLeave.validityMonths` | 대체휴무 원칙상 사용 기한. 발생량은 설정 없이 1회당 1일(`leave.minutesPerDay`) 고정 — 예전 `weekendDutyMinutes`·`holidayWorkMinutes`는 읽을 때 무시 | 1 |
| `meal.minOvertimeMinutes` | 매식비 발생 기준(정규근무 종료 후 연장) | 60 |
| `meal.holidayMinWorkMinutes` | 매식비 발생 기준(휴일근무 실근무, 없으면 240) | 240 |
| `meal.allowCarryOver` | 다음 달 사용 허용 | `false` |
| `travel.thresholdMinutes` | 4시간 기준 | 240 |
| `travel.inside` / `travel.outside` | `{ under: number \| null, over: number \| null, dailyCap }` — null은 "설정 필요" | 관내 10000/20000/20000, 관외 null/25000/25000 |
| `pay.payday` | 급여일(주말·공휴일이면 직전 영업일) | 25 |
| `pay.rounding` | 공제 요율 계산 반올림 `round` \| `floor10` | `round` |
| `pay.profiles` | 급여 설정 이력 `PayProfile[]` (적용 시작 월 기준) | 1개 |
| `specialLeaveTypes` | 특별휴가 유형 `[{ id, name, archived }]` | 경조사휴가, 기타 특별휴가 |
| `session.idleLogoutMinutes` | 자동 로그아웃 | 30 |
| `tax.familyCount`, `tax.childCount` | 소득세 간이세액표 계산 기준: 공제대상 가족 수(본인 포함), 8~20세 자녀 수 (없으면 1, 0) | 1, 0 |

### PayProfile
```jsonc
{
  "id": "…",
  "effectiveFrom": "2026-01",          // 이 월부터 다음 프로필 전까지 적용
  "baseSalary": 0,
  "items": [ { "id": "…", "name": "교통비", "amount": 0, "taxFree": false } ],   // taxFree: 비과세(소득세 과세급여에서 뺌), 없으면 false
  "deductions": [
    { "id": "pension", "name": "국민연금", "method": "amount", "value": 0, "base": "base-salary" },
    { "id": "ltc", "name": "장기요양보험", "method": "rate", "value": 12.95, "base": "deduction:health" }
  ]
}
```
- 소득세·지방소득세는 공제 항목에 두지 않고 간이세액표로 자동 계산한다. 예전 기본 항목 `income-tax`·`local-tax`가 남아 있으면 값은 보존하되 계산·화면에서 제외한다.
- `method`: `amount`(금액) \| `rate`(요율 %)
- `base`(요율일 때): `base-salary`(기본급) \| `fixed-pay`(기본급+수당 항목) \| `gross`(연장·휴일수당 포함 지급 합계) \| `deduction:<id>`(다른 공제액)
- 법정 요율을 기본값으로 넣지 않는다(모두 0).

## WorkType
`{ id, name, color, countsAsWork, archived, category }`
- `category`: `regular` \| `flex` \| `weekday-duty` \| `weekend-duty` \| `holiday-work` \| `off` \| `custom`
- 기본 시간·보상 규칙은 category로 결정한다. 사용 중인 유형은 삭제 대신 숨김.

## Entry
### WorkEntry (`kind: "work"`)
| 필드 | 내용 |
|---|---|
| `date`, `endDate` | 근무일, 종료일(다음 날 종료면 +1일) |
| `workTypeId`, `startTime`, `endTime`, `endsNextDay`, `breakMinutes`, `note` | v1과 같음 |
| `overtime` | `[{ startTime, endTime, endsNextDay }]` 근무 시작 전·종료 후 구간. 근무일 기준 시각. 길이는 `overtime.unitMinutes`의 배수, 정규 근무 구간·다른 구간과 겹치지 않음 |
| `holidayCompensation` | 휴일근무만: `allowance` \| `comp-leave` \| `trip-comp`(출장: 한도 제외, 대체휴무), 그 외 `null`. 주말 당직은 항상 대체휴무 |
| `compExpiresOn` | 대체휴무가 발생하는 근무의 원칙상 사용 기한(저장 시 발생일 + `validityMonths`, 날짜가 그대로면 유지). 그 외 `null`. 없으면 null로 읽고 계산값 사용 |

### LeaveEntry (`kind: "leave"`)
| 필드 | 내용 |
|---|---|
| `leaveType` | `annual` \| `half-am` \| `half-pm` \| `outing` \| `early-leave` \| `official` \| `sick` \| `special` \| `comp` |
| `date`, `endDate` | 기간 (반차·외출·조퇴는 하루). 연도를 넘길 수 없음 |
| `startTime`, `endTime` | 시간 단위일 때 (없으면 null) |
| `minutes` | 사용량(분). 연차 n일 = n × 480, 반차 = 240 |
| `specialTypeId` | 특별휴가 유형 (그 외 null) |
| `compSourceId` | 대체휴무 사용: 사용할 발생 건(주말 당직·휴일근무 일정 id). null이면 자동. 발생 건이 삭제·변경되면 null로 되돌림 |
| `note` | 비고 |

### TripEntry (`kind: "trip"`)
`{ id, kind, date, endDate, tripType: "inside" | "outside", startTime, endTime, note }` — 출발일 `date` `startTime`, 복귀일 `endDate` `endTime` (당일이면 같은 날, 최대 31일). 출장비는 계산값.

## MealUsage
`{ id, sourceDate, usedDate, place, used, note }`
- `sourceDate`는 매식비가 발생한 날짜(발생 건은 그날 1건). 발생 건과의 연결 키다.
- 발생 건이 사라지면(연장근무 삭제) 연결이 끊긴 사용 내역으로 표시하고 자동 삭제하지 않는다.

## 계산 규칙 요약
- **연장근무 한도**: 근무일 기준 월(1일~말일) `capMinutes`, 주(월~일) `weeklyCapMinutes`. 저장으로 한도 대상 시간이 늘어 한도를 넘으면 저장 차단. 한도 대상 = 연장근무 구간 + (설정 시) 휴일근무 수당분. 휴일근무 출장(`trip-comp`)의 근무시간은 제외.
- **연장근무 정산 기간**: 급여 월 M의 기간 = (M-1)월 `periodStartDay`일 ~ M월 (`periodStartDay`-1)일. 전체 기록을 시작 시각순으로 누적해 월·주 한도를 넘는 분은 미인정(0원)으로 두고, 기간 안의 기록만 수당에 합산한다.
- **연장 수당** = 인정 분 × 단가 ÷ 60 (원 단위 반올림). 30분 = 9,025원.
- **휴일근무** (실근무 = 경과 − `breakMinutes`, 최대 8시간 인정, 휴일근무의 `overtime` 구간은 계산에서 제외):
  - 실근무 ≥ 8시간: `comp-leave`·`trip-comp` → 대체휴무 1일, 수당 0. `allowance` → `allowanceMinutes` × 단가 ÷ 60 = 135,375원, 한도 포함은 `holidayAllowanceCountsTowardCap`
  - 실근무 < 8시간: 저장된 보상과 관계없이 수당 = 실근무 × 단가 ÷ 60, 대체휴무 없음, 월·주 한도에 항상 포함. 입력 화면은 `allowance`로 저장
  - 수당은 근무일이 속한 산정 기간의 급여 월에 반영.
- **대체휴무**: 주말 당직·휴일근무(대체휴무·출장 선택) 1회당 발생, 기한 = `compExpiresOn`(없으면 발생일 + `validityMonths`). 사용(`comp`)은 발생 건을 고른 경우 그 건에서, 아니면 사용일 기준 기한 안의 발생분을 기한이 빠른 순으로, 그다음 기한 지난 발생분에서 차감. 기한이 지나도 자동 소멸하지 않고 '기한 지남'(사용 가능)으로 표시. `compDismissals`에 있는 발생 건은 삭제한 날 이후 사용에 차감하지 않으며, 발생 일정이 없어지면 삭제 기록도 정리.
- **매식비**: 근무 종료 후 연장 구간 합계 ≥ `minOvertimeMinutes`인 날(휴일근무 제외), 또는 휴일근무 실근무 ≥ `holidayMinWorkMinutes`인 날 1건. 월별(1일~말일) 발생·사용·잔여.
- **출장비**: 건별 금액(당일은 4시간 기준, 여러 날 출장은 날마다 4시간 이상 금액) → 일자별 합계를 그날의 한도(관외 출장이 있으면 관외 한도, 아니면 관내 한도)로 제한. 금액이 null인 구간은 "설정 필요"로 합계에서 제외. 급여 실수령액에 포함하지 않는다.
- **연차 잔여** = 부여(직접 입력 또는 참고값 + 추가 부여) − 차감 대상 사용 분. 차감 대상: 연차·반차, 설정에 따라 외출·조퇴(기본 차감)·공가·병가.
- **여러 날 연차 일수** = 기간 중 주말·공휴일을 뺀 날 수(직접 수정 가능).
- **급여 지급일** = 해당 월 `payday`일. 주말·공휴일이면 하루씩 앞당긴다.
- **월 급여**: 그 월에 적용되는 PayProfile 기준. 지급 합계 = 기본급 + 수당 항목 + 연장 수당(산정 기간) + 휴일근무 수당. 실수령 예상 = 지급 합계 − 공제 합계 − 소득세 − 지방소득세. 출장비는 별도 표시.
- **소득세** = 간이세액표(`src/lib/tax_table.json`)에서 과세급여(지급 합계 − 비과세 항목)·`tax.familyCount`로 찾은 세액 − 자녀 공제(`tax.childCount`), 0원 미만이면 0원. **지방소득세** = floor(소득세 ÷ 100) × 10.

## 마이그레이션 v1 → v2
| v1 | v2 |
|---|---|
| 근무 유형 `work`·`off` | category `regular`·`off`, 나머지 v1 유형은 `custom`으로 유지 |
| (없음) | 유연근무·평일당직·주말당직·휴일근무 유형 추가 |
| 근무 일정 | `overtime: []`, `holidayCompensation: null` 추가 |
| 휴가 `leaveUnits`(일) | `minutes` = 일 × 480 (반차 240) |
| 휴가 `other` | `special` + 특별휴가 유형 "기타 특별휴가" |
| `annualLeaveByYear[YYYY].grantedDays` | `leave.grants[YYYY].days` |
| 급여 `monthlySalary`, `fixedAllowances`, `estimatedDeductions` | 프로필의 기본급, 수당 항목 "고정수당", 공제 항목 "기타 공제" |
| 급여 `mode`, `hourlyRate`, `monthlyStandardMinutes`, `rules` | `legacy.pay`에 원본 보존 (v2에서는 계산에 쓰지 않음) |

## 저장·동기화
- 앱 시작·로그인 시 파싱 → 마이그레이션 → 스키마 검증. 실패하면 원본을 덮어쓰지 않고 복구 화면을 보여준다.
- Drive 저장 전 파일 `version`을 확인해 마지막으로 읽은 값과 다르면 충돌로 처리(덮어쓰지 않음).
- JSON 백업 형식: `{ format: "work-schedule-backup", exportedAt, data }`. v1 백업도 가져올 수 있다(자동 변환).
