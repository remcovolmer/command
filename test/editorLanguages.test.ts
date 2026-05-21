import { describe, test, expect } from 'vitest'
import { getMonacoLanguage, isEditableFile, EXT_TO_LANGUAGE } from '../src/utils/editorLanguages'

describe('getMonacoLanguage', () => {
  test('maps .html to html', () => {
    expect(getMonacoLanguage('foo/bar.html')).toBe('html')
  })

  test('maps .htm to html', () => {
    expect(getMonacoLanguage('foo/bar.htm')).toBe('html')
  })

  test('falls back to plaintext for unknown extensions', () => {
    expect(getMonacoLanguage('foo/bar.unknownext')).toBe('plaintext')
  })

  test('handles uppercase extensions', () => {
    expect(getMonacoLanguage('INDEX.HTM')).toBe('html')
  })

  test('handles uppercase .HTML extension', () => {
    expect(getMonacoLanguage('INDEX.HTML')).toBe('html')
  })
})

describe('isEditableFile', () => {
  test('.htm is editable', () => {
    expect(isEditableFile('index.htm', 'htm')).toBe(true)
  })

  test('.html is editable', () => {
    expect(isEditableFile('index.html', 'html')).toBe(true)
  })

  test('dotfiles are editable even without registered extension', () => {
    expect(isEditableFile('.envrc')).toBe(true)
  })
})

describe('EXT_TO_LANGUAGE', () => {
  test('exposes both html and htm as html', () => {
    expect(EXT_TO_LANGUAGE.html).toBe('html')
    expect(EXT_TO_LANGUAGE.htm).toBe('html')
  })
})
