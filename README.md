# 개인 근무표·급여 관리

근무 일정(기본·유연·당직·휴일근무), 연장근무와 한도, 매식비, 출장비, 연차·대체휴무, 월 급여를 한곳에서 관리하는 개인용 웹 애플리케이션입니다.
본인 Google 계정으로 로그인하면 어느 컴퓨터·휴대폰에서든 같은 데이터를 사용합니다.

## 구성 (100% 무료, 서버 없음)
| 구성 요소 | 역할 |
|---|---|
| GitHub Pages | 정적 사이트 호스팅 (공개 저장소, GitHub Actions 자동 배포) — https://ch0rong.github.io/work-schedule/ |
| Google 로그인 (Google Identity Services) | 본인 계정 인증 |
| Google Drive appDataFolder | 데이터 JSON 저장·동기화 (Drive의 앱 전용 숨김 폴더) |

접근 제한: Google OAuth 앱을 "테스트" 상태로 두고 본인 이메일만 테스트 사용자로 등록 → 다른 계정에는 로그인 권한이 발급되지 않습니다. 앱도 허용 이메일(해시)과 다르면 화면·데이터를 차단합니다. 자세한 내용은 [REQUIREMENTS.md](./REQUIREMENTS.md) 3장.

## 기술 스택
React + TypeScript(strict) · Vite · FullCalendar v7 · date-fns · Zod · lucide-react · Vitest + Testing Library

## 로컬 실행 (개발)
```bash
npm install
npm run dev
```
로그인 연동 전(9단계 이전)에는 브라우저 localStorage에 저장하는 개발 모드로 동작합니다.

## 테스트와 빌드
```bash
npm run test      # 단위·컴포넌트 테스트
npm run lint      # ESLint
npm run build     # 타입 검사 + 프로덕션 빌드 (dist/)
npm run preview   # 빌드 결과 미리보기
```
`vite.config.ts`의 `base`는 GitHub Pages 프로젝트 주소에 맞춘 `/work-schedule/`입니다. 개발 주소: `http://localhost:5173/work-schedule/`

## 환경변수 (배포 시)
`.env`는 커밋하지 않습니다. GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**에 넣으면 배포 빌드에 들어갑니다. 두 값 모두 화면 코드에 드러나는 공개 값입니다(비밀값 아님).
| 이름 | 내용 |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID (공개 값) |
| `VITE_ALLOWED_EMAIL_SHA256` | 허용 이메일(소문자)의 SHA-256 해시. 여러 명이면 쉼표로 구분 |

## Google 로그인 설정 (본인이 직접 하는 작업, 무료)
로그인 정보(클라이언트 ID)가 없으면 개발 서버에서는 **로컬 모드**(로그인 없음, 이 브라우저에만 저장)로, 배포 빌드에서는 **접근 차단 화면**으로 동작합니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트를 만듭니다.
2. **API 및 서비스 → 라이브러리**에서 **Google Drive API**를 사용 설정합니다.
3. **OAuth 동의 화면(Google Auth Platform)**
   - 사용자 유형: 외부, 앱 이름·지원 이메일 입력
   - 데이터 액세스(범위): `.../auth/drive.appdata`, `openid`, `email`
   - **게시 상태는 "테스트"로 유지**하고, **테스트 사용자에 본인 Gmail만 추가** ← 다른 계정 로그인을 Google이 차단하는 핵심 설정
4. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션**
   - 승인된 JavaScript 원본: `http://localhost:5173` (개발), 배포 후 `https://<프로젝트>.pages.dev` 추가
   - 리디렉션 URI는 필요 없습니다(토큰 방식). 클라이언트 보안 비밀은 사용하지 않습니다.
5. 프로젝트 폴더에 `.env.local` 파일을 만듭니다(커밋되지 않음).
   ```bash
   VITE_GOOGLE_CLIENT_ID=발급받은-클라이언트-ID.apps.googleusercontent.com
   VITE_ALLOWED_EMAIL_SHA256=아래 명령으로 만든 값
   ```
   허용 이메일 해시 만들기(이메일은 소문자로):
   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('본인@gmail.com'.trim().toLowerCase()).digest('hex'))"
   ```
6. `npm run dev`를 다시 시작하면 로그인 화면이 나옵니다. 테스트 상태의 앱이라 "Google에서 확인하지 않은 앱" 안내가 보일 수 있으며, 본인 앱이므로 계속 진행하면 됩니다.

데이터는 본인 Google Drive의 **앱 전용 숨김 폴더**에 저장됩니다(Drive 화면에는 보이지 않음). 같은 OAuth 클라이언트를 계속 써야 같은 데이터가 보이므로 프로젝트·클라이언트를 지우지 마세요. 정기적인 JSON 백업을 권장합니다.

## 배포 (GitHub Pages)
저장소는 **공개**입니다. 비밀값·개인정보·근무 데이터는 저장소에 넣지 않습니다(데이터는 본인 Google Drive에만 저장).

1. `main` 브랜치에 올리면 `.github/workflows/deploy.yml`이 린트 → 테스트 → 빌드 → 배포를 실행합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. 저장소 **Settings → Secrets and variables → Actions → Variables**에 `VITE_GOOGLE_CLIENT_ID`, `VITE_ALLOWED_EMAIL_SHA256` 추가 후 Actions에서 다시 실행
4. Google Cloud OAuth 클라이언트의 **승인된 JavaScript 원본**에 `https://ch0rong.github.io` 추가 (경로 없이)
5. 주소: https://ch0rong.github.io/work-schedule/

## 다른 사람 추가하기 (100명까지)
각 사용자의 데이터는 **본인 Google Drive의 앱 전용 폴더**에 따로 저장되어 서로 보이지 않습니다. 두 곳에 모두 등록해야 들어올 수 있습니다.

1. **Google Cloud Console → Google Auth Platform → 대상(Audience) → 테스트 사용자 → 사용자 추가**에 그 사람의 Gmail 입력 (본인을 등록할 때와 같음, 최대 100명)
2. 앱 허용 목록에 추가 (해시만 저장되고 이메일 원문은 남지 않음, 자동으로 다시 배포):
   ```bash
   node scripts/allowed-emails.mjs add 친구@gmail.com
   ```
   해제는 `remove`, 확인은 `check 이메일`, 인원 수는 `count`.

보안 정책(CSP)은 GitHub Pages가 헤더를 지원하지 않아 배포 빌드의 index.html에 meta 태그로 들어갑니다(`vite.config.ts`).
설정값(클라이언트 ID·허용 이메일 해시)이 없으면 배포 사이트는 접근 차단 화면만 보여줍니다.

## 데이터 백업·복원
- **마이페이지 → 데이터 백업·복원 → JSON 백업 내려받기**: `work-schedule-backup-YYYY-MM-DD-HHmm.json`. 근무·급여 정보가 들어 있으니 보관·공유에 주의하세요.
- **백업 파일 가져오기**: 형식·버전·내용을 검증하고, 문제가 있으면 아무것도 바꾸지 않습니다. 확인 창에서 "현재 데이터 백업 후 가져오기"(권장) / "백업 없이 덮어쓰기" / "취소"를 고릅니다.
- v1(로컬 버전) 백업도 가져올 수 있으며 v2 형식으로 자동 변환됩니다. v2에 대응 항목이 없는 v1 급여 설정(시급제, 사용자 정의 수당 규칙)은 데이터 안 `legacy`에 원본 그대로 보존됩니다.
- 저장 데이터가 손상되면 원본을 덮어쓰지 않고 **데이터 복구** 화면을 보여줍니다.

### 기존 데이터 이전 (v1 → v2)
1. 기존 브라우저에서 앱을 열고 JSON 백업을 내려받아 보관합니다.
2. 새 버전에서 로그인한 뒤 백업 파일을 가져옵니다(자동 변환·검증 후 Drive에 저장).
3. 원본 백업 파일과 기존 브라우저 데이터는 자동으로 삭제되지 않습니다.

## 급여 계산 안내
계산 결과는 사용자가 입력한 급여·공제·수당 설정에 기반한 **예상치**입니다. 4대보험 요율은 임의로 추정하지 않으며, 소득세·지방소득세는 국세청 근로소득 간이세액표(원천징수 100%)로 계산합니다. 실제 지급액과 다를 수 있습니다. 실제 입금액은 월별 급여 화면에서 따로 기록합니다. 출장비는 급여와 별도 지급으로 보고 실수령액에 포함하지 않습니다.

## 근로소득 간이세액표 갱신
국세청 간이세액표(xlsx)가 바뀌면 프로젝트 폴더에서 다시 변환한다. 앱은 변환 결과 `src/lib/tax_table.json`만 불러오며(불러올 때 형식 검증), 실행 시 엑셀이나 Python이 필요 없다.

```bash
python -m venv .venv                      # 처음 한 번 (프로젝트 안 가상환경)
.venv/Scripts/python -m pip install openpyxl
.venv/Scripts/python scripts/parse_income_tax_table.py "근로소득 간이세액표_2026.03.01.xlsx"
npm run test                              # 표 값·계산식 검증
```
스크립트는 구간 연속성, 세액 단조성, 10,000천원 초과 계산식의 구간 간 연속성을 검사하고 어긋나면 변환을 중단한다.

## 관련 문서
- [요구사항](./REQUIREMENTS.md) · [디자인 가이드](./DESIGN.md) · [데이터 구조](./DATABASE.md) · [AI 개발 지침](./AGENTS.md) · [개발 작업 목록](./TASKS.md)
