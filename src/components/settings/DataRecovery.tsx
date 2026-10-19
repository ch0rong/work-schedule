import { ErrorMessage } from '../common/ErrorMessage'
import { DataManagement } from './DataManagement'

interface DataRecoveryProps {
  errors: string[]
}

/** 저장된 데이터가 손상되었을 때 다른 화면 대신 보여준다. 원본은 덮어쓰지 않은 상태다. */
export function DataRecovery({ errors }: DataRecoveryProps) {
  return (
    <div className="stack">
      <ErrorMessage title="저장된 데이터를 읽을 수 없습니다." messages={errors} />
      <p>
        원본 데이터는 아직 그대로 보존되어 있습니다. 먼저 <strong>손상된 원본 내려받기</strong>로 보관한 뒤, 이전 백업
        파일을 가져오거나 데이터를 초기화하세요.
      </p>
      <DataManagement />
    </div>
  )
}
