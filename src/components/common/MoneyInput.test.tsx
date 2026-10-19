import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MoneyInput } from './MoneyInput'

function Harness({ initial = null }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <>
      <MoneyInput aria-label="금액" value={value} onChange={setValue} />
      <output>{value === null ? 'null' : value}</output>
    </>
  )
}

describe('MoneyInput', () => {
  it('입력하는 동안 천 단위 쉼표를 찍고 값은 숫자로 넘긴다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('금액')
    await user.type(input, '2850000')
    expect(input).toHaveValue('2,850,000')
    expect(screen.getByRole('status')).toHaveTextContent('2850000')
  })

  it('숫자가 아닌 글자는 무시하고, 모두 지우면 빈 값', async () => {
    const user = userEvent.setup()
    render(<Harness initial={18050} />)
    const input = screen.getByLabelText('금액')
    expect(input).toHaveValue('18,050')
    await user.type(input, 'a원')
    expect(input).toHaveValue('18,050')
    await user.clear(input)
    expect(input).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('null')
  })

  it('휴대폰에서 숫자 키패드가 뜨도록 inputmode=numeric', () => {
    render(<Harness />)
    expect(screen.getByLabelText('금액')).toHaveAttribute('inputmode', 'numeric')
  })
})
