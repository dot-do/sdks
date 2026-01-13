# RpcTransport

Interface for implementing custom RPC transports.

## Overview

`RpcTransport` is the interface Cap'n Web uses for sending and receiving messages. Implementing this interface allows you to use Cap'n Web over any bidirectional communication channel.

## Interface Definition

```typescript
interface RpcTransport {
  /**
   * Sends a message to the other end.
   */
  send(message: string): Promise<void>

  /**
   * Receives a message sent by the other end.
   *
   * If the transport becomes disconnected, this should reject.
   * The error will propagate to all outstanding calls.
   */
  receive(): Promise<string>

  /**
   * Optional: Called when the RPC system encounters an error.
   * Should attempt to send queued messages, then close.
   */
  abort?(reason: any): void
}
```

## Using Custom Transports

```typescript
import { RpcSession, RpcTarget } from 'capnweb'

// Create your transport
const transport: RpcTransport = new MyCustomTransport()

// Create the local API to expose
const localApi = new MyApi()

// Start the session
const session = new RpcSession<RemoteApi>(transport, localApi)

// Get a stub for the remote API
const remoteApi = session.getRemoteMain()

// Make calls
await remoteApi.hello('World')
```

## Implementation Examples

### TCP Socket Transport

```typescript
import net from 'node:net'

class TcpTransport implements RpcTransport {
  private buffer = ''
  private pendingReceives: Array<{
    resolve: (msg: string) => void
    reject: (err: Error) => void
  }> = []
  private closed = false

  constructor(private socket: net.Socket) {
    socket.setEncoding('utf8')

    socket.on('data', (data: string) => {
      this.buffer += data

      // Messages are newline-delimited
      let newlineIndex: number
      while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
        const message = this.buffer.slice(0, newlineIndex)
        this.buffer = this.buffer.slice(newlineIndex + 1)

        const pending = this.pendingReceives.shift()
        if (pending) {
          pending.resolve(message)
        }
      }
    })

    socket.on('close', () => {
      this.closed = true
      const error = new Error('Connection closed')
      for (const pending of this.pendingReceives) {
        pending.reject(error)
      }
      this.pendingReceives = []
    })

    socket.on('error', (err) => {
      this.closed = true
      for (const pending of this.pendingReceives) {
        pending.reject(err)
      }
      this.pendingReceives = []
    })
  }

  async send(message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(message + '\n', (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async receive(): Promise<string> {
    // Check if there's already a complete message
    const newlineIndex = this.buffer.indexOf('\n')
    if (newlineIndex !== -1) {
      const message = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      return message
    }

    if (this.closed) {
      throw new Error('Connection closed')
    }

    // Wait for data
    return new Promise((resolve, reject) => {
      this.pendingReceives.push({ resolve, reject })
    })
  }

  abort(reason: any): void {
    this.socket.end()
  }
}
```

### Redis Pub/Sub Transport

```typescript
import Redis from 'ioredis'

class RedisPubSubTransport implements RpcTransport {
  private subscriber: Redis
  private publisher: Redis
  private messageQueue: string[] = []
  private pendingReceive?: {
    resolve: (msg: string) => void
    reject: (err: Error) => void
  }

  constructor(
    redisUrl: string,
    private sendChannel: string,
    private receiveChannel: string
  ) {
    this.subscriber = new Redis(redisUrl)
    this.publisher = new Redis(redisUrl)

    this.subscriber.subscribe(receiveChannel)
    this.subscriber.on('message', (channel, message) => {
      if (channel === receiveChannel) {
        if (this.pendingReceive) {
          this.pendingReceive.resolve(message)
          this.pendingReceive = undefined
        } else {
          this.messageQueue.push(message)
        }
      }
    })
  }

  async send(message: string): Promise<void> {
    await this.publisher.publish(this.sendChannel, message)
  }

  async receive(): Promise<string> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!
    }

    return new Promise((resolve, reject) => {
      this.pendingReceive = { resolve, reject }
    })
  }

  abort(): void {
    this.subscriber.disconnect()
    this.publisher.disconnect()
  }
}
```

### Browser Broadcast Channel Transport

```typescript
class BroadcastChannelTransport implements RpcTransport {
  private channel: BroadcastChannel
  private messageQueue: string[] = []
  private pendingReceive?: {
    resolve: (msg: string) => void
    reject: (err: Error) => void
  }

  constructor(channelName: string, private clientId: string) {
    this.channel = new BroadcastChannel(channelName)

    this.channel.onmessage = (event) => {
      // Ignore messages from self
      if (event.data.from === clientId) return

      const message = event.data.message
      if (this.pendingReceive) {
        this.pendingReceive.resolve(message)
        this.pendingReceive = undefined
      } else {
        this.messageQueue.push(message)
      }
    }
  }

  async send(message: string): Promise<void> {
    this.channel.postMessage({
      from: this.clientId,
      message
    })
  }

  async receive(): Promise<string> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!
    }

    return new Promise((resolve, reject) => {
      this.pendingReceive = { resolve, reject }
    })
  }

  abort(): void {
    this.channel.close()
  }
}
```

### WebRTC DataChannel Transport

```typescript
class WebRTCTransport implements RpcTransport {
  private messageQueue: string[] = []
  private pendingReceive?: {
    resolve: (msg: string) => void
    reject: (err: Error) => void
  }

  constructor(private dataChannel: RTCDataChannel) {
    dataChannel.onmessage = (event) => {
      const message = event.data as string
      if (this.pendingReceive) {
        this.pendingReceive.resolve(message)
        this.pendingReceive = undefined
      } else {
        this.messageQueue.push(message)
      }
    }

    dataChannel.onclose = () => {
      if (this.pendingReceive) {
        this.pendingReceive.reject(new Error('DataChannel closed'))
        this.pendingReceive = undefined
      }
    }
  }

  async send(message: string): Promise<void> {
    this.dataChannel.send(message)
  }

  async receive(): Promise<string> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!
    }

    if (this.dataChannel.readyState !== 'open') {
      throw new Error('DataChannel not open')
    }

    return new Promise((resolve, reject) => {
      this.pendingReceive = { resolve, reject }
    })
  }

  abort(): void {
    this.dataChannel.close()
  }
}
```

## Message Format

Messages exchanged over the transport are JSON strings. Cap'n Web handles serialization/deserialization internally.

Example messages:

```json
// Method call
{
  "type": "call",
  "id": 1,
  "target": 0,
  "method": "greet",
  "args": ["World"]
}

// Response
{
  "type": "return",
  "id": 1,
  "value": "Hello, World!"
}

// Error
{
  "type": "throw",
  "id": 1,
  "error": {
    "name": "Error",
    "message": "Something went wrong"
  }
}
```

## Best Practices

### 1. Handle Connection Loss

```typescript
class MyTransport implements RpcTransport {
  async receive(): Promise<string> {
    try {
      return await this.doReceive()
    } catch (error) {
      // Connection lost - all pending calls will fail
      throw new Error('Transport disconnected')
    }
  }
}
```

### 2. Implement Graceful Shutdown

```typescript
class MyTransport implements RpcTransport {
  abort(reason: any): void {
    // Flush any queued messages
    this.flushQueue()
    // Then close
    this.close()
  }
}
```

### 3. Handle Backpressure

```typescript
class MyTransport implements RpcTransport {
  private sendQueue: string[] = []
  private sending = false

  async send(message: string): Promise<void> {
    this.sendQueue.push(message)
    if (!this.sending) {
      await this.processSendQueue()
    }
  }

  private async processSendQueue(): Promise<void> {
    this.sending = true
    while (this.sendQueue.length > 0) {
      const message = this.sendQueue.shift()!
      await this.doSend(message)
    }
    this.sending = false
  }
}
```

### 4. Add Timeouts

```typescript
class MyTransport implements RpcTransport {
  async receive(): Promise<string> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Receive timeout')), 30000)
    })

    return Promise.race([this.doReceive(), timeoutPromise])
  }
}
```
