/** 배포 설정이 빠졌을 때 앱 대신 보여준다 (설정 누락 시 접근 차단) */
export function ConfigError({ message }: { message: string }) {
  return (
    <main className="login-page">
      <div className="login-card card" role="alert">
        <h1 className="app-title">근무 스케줄</h1>
        <p>{message}</p>
      </div>
    </main>
  )
}
