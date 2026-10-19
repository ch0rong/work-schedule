import { AlertTriangle } from 'lucide-react'

interface ErrorMessageProps {
  title: string
  messages?: string[]
}

/** 오류를 색상만이 아니라 아이콘·문구로도 알린다. */
export function ErrorMessage({ title, messages = [] }: ErrorMessageProps) {
  return (
    <div className="alert alert-danger" role="alert">
      <AlertTriangle aria-hidden="true" size={18} className="alert-icon" />
      <div>
        <p className="alert-title">{title}</p>
        {messages.length > 0 && (
          <ul className="alert-list">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
