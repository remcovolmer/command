import { describe, test, expect } from 'vitest'
import { describeLoadError, isAbort, ERR_ABORTED } from '../src/utils/browserLoadError'

describe('isAbort', () => {
  test('true only for ERR_ABORTED (-3)', () => {
    expect(isAbort(ERR_ABORTED)).toBe(true)
    expect(isAbort(-3)).toBe(true)
    expect(isAbort(-102)).toBe(false)
    expect(isAbort(0)).toBe(false)
  })
})

describe('describeLoadError', () => {
  const at = (errorDescription: string, errorCode = -100) =>
    describeLoadError({ url: 'http://localhost:5173', errorCode, errorDescription })

  test('connection refused points at the dev-server', () => {
    expect(at('ERR_CONNECTION_REFUSED')).toContain('dev-server')
  })

  test('DNS failure asks to check the URL', () => {
    expect(at('ERR_NAME_NOT_RESOLVED')).toContain('URL')
  })

  test('timeouts map to a timeout message', () => {
    expect(at('ERR_TIMED_OUT')).toContain('timeout')
    expect(at('ERR_CONNECTION_TIMED_OUT')).toContain('timeout')
  })

  test('certificate errors map to a cert message', () => {
    expect(at('ERR_CERT_AUTHORITY_INVALID')).toContain('Certificaat')
  })

  test('unknown codes fall back to the raw description', () => {
    expect(at('ERR_SOMETHING_WEIRD')).toBe('ERR_SOMETHING_WEIRD')
  })

  test('empty description falls back to a generic line', () => {
    expect(at('')).toContain('kon niet worden geladen')
  })
})
