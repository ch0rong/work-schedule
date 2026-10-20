// 허용 이메일 관리 (GitHub Actions 변수 VITE_ALLOWED_EMAIL_SHA256, 해시만 저장)
//   node scripts/allowed-emails.mjs add 친구@gmail.com      허용 추가 후 다시 배포
//   node scripts/allowed-emails.mjs remove 친구@gmail.com   허용 해제 후 다시 배포
//   node scripts/allowed-emails.mjs check 친구@gmail.com    허용 여부 확인
//   node scripts/allowed-emails.mjs count                   허용된 계정 수
// 이메일 원문은 저장소·변수 어디에도 남기지 않는다. gh CLI 로그인이 필요하다.
// Google Cloud Console의 OAuth 테스트 사용자에도 같은 이메일을 따로 추가해야 로그인할 수 있다.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const VARIABLE = 'VITE_ALLOWED_EMAIL_SHA256'
const WORKFLOW = 'deploy.yml'

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()
const hashOf = (email) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
const read = () => gh('variable', 'get', VARIABLE).split(/[\s,]+/).map((hash) => hash.trim().toLowerCase()).filter((hash) => /^[0-9a-f]{64}$/.test(hash))

function write(hashes) {
  if (hashes.length === 0) throw new Error('허용 계정이 0명이 되면 아무도 들어올 수 없어 저장하지 않습니다.')
  gh('variable', 'set', VARIABLE, '--body', hashes.join(','))
  gh('workflow', 'run', WORKFLOW)
  console.log(`허용 계정 ${hashes.length}명으로 저장했습니다. 다시 배포를 시작했습니다 (1~2분 뒤 반영).`)
}

const [command, email] = process.argv.slice(2)
const needsEmail = ['add', 'remove', 'check'].includes(command)
if (!['add', 'remove', 'check', 'count'].includes(command) || (needsEmail && !email?.includes('@'))) {
  console.error('사용법: node scripts/allowed-emails.mjs <add|remove|check> 이메일  |  node scripts/allowed-emails.mjs count')
  process.exit(1)
}

const hashes = read()
const hash = email ? hashOf(email) : ''
if (command === 'count') {
  console.log(`허용 계정 ${hashes.length}명`)
} else if (command === 'check') {
  console.log(hashes.includes(hash) ? '허용된 계정입니다.' : '허용되지 않은 계정입니다.')
} else if (command === 'add') {
  if (hashes.includes(hash)) console.log('이미 허용된 계정입니다.')
  else write([...hashes, hash])
} else {
  if (!hashes.includes(hash)) console.log('허용 목록에 없는 계정입니다.')
  else write(hashes.filter((item) => item !== hash))
}
