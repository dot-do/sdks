import { describe, it, expect } from 'vitest'
import { {{Name}}Client } from '../src/index'

describe('{{Name}}Client', () => {
  it('should create a client with default options', () => {
    const client = new {{Name}}Client()
    expect(client).toBeInstanceOf({{Name}}Client)
  })

  it('should create a client with custom options', () => {
    const client = new {{Name}}Client({
      apiKey: 'test-key',
      baseUrl: 'https://custom.{{name}}.do',
    })
    expect(client).toBeInstanceOf({{Name}}Client)
  })
})
