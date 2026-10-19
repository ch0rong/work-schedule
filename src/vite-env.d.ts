/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 클라이언트 ID (공개 값). 설정하면 로그인 모드로 동작 */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** 허용 이메일(소문자)의 SHA-256 16진수 */
  readonly VITE_ALLOWED_EMAIL_SHA256?: string
  /** 'true'면 프로덕션 빌드에서도 로그인 없는 로컬 모드 허용 (미리보기용) */
  readonly VITE_ALLOW_LOCAL_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
