import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom은 <dialog>의 모달 API와 Blob URL을 구현하지 않으므로 테스트용으로만 보완한다.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
URL.createObjectURL ??= () => 'blob:test'
URL.revokeObjectURL ??= () => {}

afterEach(() => {
  cleanup()
  localStorage.clear()
})
