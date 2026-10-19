/** 금액 입력: 화면에는 천 단위 쉼표, 값은 원 단위 정수 */

/** 1234567 → `1,234,567`, 비어 있으면 '' */
export function formatMoneyInput(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : Math.trunc(value).toLocaleString('ko-KR')
}

/** `1,234,567원` → 1234567. 숫자가 없으면 null (쉼표·공백·'원' 등 숫자 외 문자는 무시) */
export function parseMoneyInput(text: string): number | null {
  const digits = text.replace(/\D/g, '')
  return digits === '' ? null : Number(digits)
}

/** 서식 전 문자열에서 커서 앞 숫자 개수 → 서식 후 커서 위치 */
export function caretAfterDigits(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0
  let seen = 0
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) seen += 1
    if (seen === digitsBefore) return index + 1
  }
  return formatted.length
}
