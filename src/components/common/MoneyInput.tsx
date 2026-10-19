import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react'
import { caretAfterDigits, formatMoneyInput, parseMoneyInput } from '../../lib/money'

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** 원 단위 정수. 비어 있으면 null (NaN도 빈 칸으로 보인다) */
  value: number | null
  onChange: (value: number | null) => void
}

/**
 * 금액 입력칸. 입력하는 동안 천 단위 쉼표를 찍는다(예: 2,850,000).
 * 쉼표가 끼어들어도 커서가 끝으로 튀지 않도록 커서 앞 숫자 개수를 기준으로 위치를 되돌린다.
 */
export function MoneyInput({ value, onChange, ...rest }: MoneyInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const text = formatMoneyInput(value)

  useLayoutEffect(() => {
    const input = ref.current
    if (input && caret.current !== null && document.activeElement === input) {
      const position = caretAfterDigits(text, caret.current)
      input.setSelectionRange(position, position)
    }
    caret.current = null
  }, [text])

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const before = e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length)
        caret.current = before.replace(/\D/g, '').length
        onChange(parseMoneyInput(e.target.value))
      }}
    />
  )
}
