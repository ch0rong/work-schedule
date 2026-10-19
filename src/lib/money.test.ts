import { describe, expect, it } from 'vitest'
import { caretAfterDigits, formatMoneyInput, parseMoneyInput } from './money'

describe('금액 입력 서식', () => {
  it('천 단위 쉼표', () => {
    expect(formatMoneyInput(0)).toBe('0')
    expect(formatMoneyInput(18050)).toBe('18,050')
    expect(formatMoneyInput(2850000)).toBe('2,850,000')
    expect(formatMoneyInput(null)).toBe('')
    expect(formatMoneyInput(Number.NaN)).toBe('')
  })

  it('쉼표·원·공백을 무시하고 숫자만 읽는다', () => {
    expect(parseMoneyInput('2,850,000')).toBe(2850000)
    expect(parseMoneyInput(' 18,050원 ')).toBe(18050)
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('원')).toBeNull()
    expect(parseMoneyInput('-500')).toBe(500) // 음수 입력 불가
  })

  it('쉼표가 생겨도 커서는 같은 숫자 뒤에 둔다', () => {
    expect(caretAfterDigits('12,345', 2)).toBe(2) // 1 2 | , 3 4 5
    expect(caretAfterDigits('12,345', 3)).toBe(4) // 12,3 |
    expect(caretAfterDigits('1,234,567', 7)).toBe(9)
    expect(caretAfterDigits('1,234', 0)).toBe(0)
  })
})
