/**
 * 연도별 법정공휴일·대체공휴일 (관공서의 공휴일에 관한 규정 기준).
 * 새 연도는 우주항공청·한국천문연구원 월력요항 발표(매년 6월경) 후 이 파일에 추가한다.
 *
 * 확인일: 2026-10-19
 * - 2026·2027년 날짜: 한국천문연구원 천문우주지식정보 월력요항
 * - 제헌절(7/17)·노동절(5/1) 공휴일 지정: 관공서 공휴일 규정 개정, 2026-05-11 시행
 *   → 2026년은 제헌절만 해당(노동절 5/1은 시행 전), 2027년부터 둘 다 해당
 * - 2026-06-03 제9회 전국동시지방선거일 (공직선거법에 따른 공휴일)
 */
export interface OfficialHoliday {
  date: string
  name: string
  substitute?: boolean
}

export const OFFICIAL_HOLIDAYS: Record<string, readonly OfficialHoliday[]> = {
  '2026': [
    { date: '2026-01-01', name: '1월 1일' },
    { date: '2026-02-16', name: '설날 연휴' },
    { date: '2026-02-17', name: '설날' },
    { date: '2026-02-18', name: '설날 연휴' },
    { date: '2026-03-01', name: '3·1절' },
    { date: '2026-03-02', name: '대체공휴일(3·1절)', substitute: true },
    { date: '2026-05-05', name: '어린이날' },
    { date: '2026-05-24', name: '부처님오신날' },
    { date: '2026-05-25', name: '대체공휴일(부처님오신날)', substitute: true },
    { date: '2026-06-03', name: '전국동시지방선거' },
    { date: '2026-06-06', name: '현충일' },
    { date: '2026-07-17', name: '제헌절' },
    { date: '2026-08-15', name: '광복절' },
    { date: '2026-08-17', name: '대체공휴일(광복절)', substitute: true },
    { date: '2026-09-24', name: '추석 연휴' },
    { date: '2026-09-25', name: '추석' },
    { date: '2026-09-26', name: '추석 연휴' },
    { date: '2026-10-03', name: '개천절' },
    { date: '2026-10-05', name: '대체공휴일(개천절)', substitute: true },
    { date: '2026-10-09', name: '한글날' },
    { date: '2026-12-25', name: '기독탄신일' },
  ],
  '2027': [
    { date: '2027-01-01', name: '1월 1일' },
    { date: '2027-02-06', name: '설날 연휴' },
    { date: '2027-02-07', name: '설날' },
    { date: '2027-02-08', name: '설날 연휴' },
    { date: '2027-02-09', name: '대체공휴일(설날)', substitute: true },
    { date: '2027-03-01', name: '3·1절' },
    { date: '2027-05-01', name: '노동절' },
    { date: '2027-05-03', name: '대체공휴일(노동절)', substitute: true },
    { date: '2027-05-05', name: '어린이날' },
    { date: '2027-05-13', name: '부처님오신날' },
    { date: '2027-06-06', name: '현충일' },
    { date: '2027-07-17', name: '제헌절' },
    { date: '2027-07-19', name: '대체공휴일(제헌절)', substitute: true },
    { date: '2027-08-15', name: '광복절' },
    { date: '2027-08-16', name: '대체공휴일(광복절)', substitute: true },
    { date: '2027-09-14', name: '추석 연휴' },
    { date: '2027-09-15', name: '추석' },
    { date: '2027-09-16', name: '추석 연휴' },
    { date: '2027-10-03', name: '개천절' },
    { date: '2027-10-04', name: '대체공휴일(개천절)', substitute: true },
    { date: '2027-10-09', name: '한글날' },
    { date: '2027-10-11', name: '대체공휴일(한글날)', substitute: true },
    { date: '2027-12-25', name: '기독탄신일' },
    { date: '2027-12-27', name: '대체공휴일(기독탄신일)', substitute: true },
  ],
}

export const HOLIDAY_SOURCES: readonly { label: string; url: string }[] = [
  { label: '한국천문연구원 월력요항 2026', url: 'https://astro.kasi.re.kr/kor/life/post/calendarData?year=2026' },
  { label: '한국천문연구원 월력요항 2027', url: 'https://astro.kasi.re.kr/kor/life/post/calendarData?year=2027' },
  { label: '제헌절·노동절 공휴일 지정(2026-05-11 시행) 보도', url: 'https://www.nongmin.com/article/20260709500316' },
]
