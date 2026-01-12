/**
 * {{Name}}.do SDK
 *
 * {{description}}
 *
 * @example
 * ```typescript
 * import { {{Name}}Client } from '{{name}}.do'
 *
 * const client = new {{Name}}Client({ apiKey: process.env.DOTDO_KEY })
 * const result = await client.example()
 * ```
 */

import { connect, type RpcClient } from 'rpc.do'

export interface {{Name}}ClientOptions {
  /** API key for authentication */
  apiKey?: string
  /** Base URL for the service (defaults to https://{{name}}.do) */
  baseUrl?: string
}

/**
 * {{Name}}.do client for interacting with the {{name}} service
 */
export class {{Name}}Client {
  private rpc: RpcClient | null = null
  private options: {{Name}}ClientOptions

  constructor(options: {{Name}}ClientOptions = {}) {
    this.options = {
      baseUrl: 'https://{{name}}.do',
      ...options,
    }
  }

  /**
   * Connect to the {{name}}.do service
   */
  async connect(): Promise<RpcClient> {
    if (!this.rpc) {
      this.rpc = await connect(this.options.baseUrl!, {
        headers: this.options.apiKey
          ? { Authorization: `Bearer ${this.options.apiKey}` }
          : undefined,
      })
    }
    return this.rpc
  }

  /**
   * Disconnect from the service
   */
  async disconnect(): Promise<void> {
    if (this.rpc) {
      // Close connection if supported
      this.rpc = null
    }
  }
}

// Re-export types
export type { RpcClient }
