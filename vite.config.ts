import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * 보안 정책(CSP). GitHub Pages는 응답 헤더를 정할 수 없어 배포 빌드의 index.html에 meta 태그로 넣는다.
 * 스크립트는 이 사이트와 Google Identity Services만, 통신은 Google 로그인·Drive API만 허용한다.
 * (개발 서버는 Vite가 인라인 스크립트를 쓰므로 넣지 않는다)
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  'frame-src https://accounts.google.com/gsi/',
  "connect-src 'self' https://accounts.google.com/gsi/ https://oauth2.googleapis.com https://openidconnect.googleapis.com https://www.googleapis.com",
  "img-src 'self' data: https://*.googleusercontent.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head-prepend' },
    ],
  }
}

// GitHub Pages 프로젝트 사이트(https://ch0rong.github.io/work-schedule/)에 배포합니다.
// 저장소 이름을 바꾸면 '/저장소이름/'으로, 사용자 사이트(username.github.io)라면 '/'로 변경하세요.
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: '/work-schedule/',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
