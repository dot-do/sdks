# MessagePort Sessions

RPC over browser MessagePort for workers and iframes.

## Overview

MessagePort sessions enable RPC communication within the browser:

- Web Workers
- Service Workers
- Shared Workers
- iframes
- Same-page components

## Basic Usage

```typescript
import { newMessagePortRpcSession, RpcTarget } from 'capnweb'

// Create a MessageChannel (pair of connected ports)
const channel = new MessageChannel()

// Server side (e.g., in a Web Worker)
class Greeter extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}
newMessagePortRpcSession(channel.port1, new Greeter())

// Client side
using api = newMessagePortRpcSession<Greeter>(channel.port2)
const greeting = await api.greet('World')
console.log(greeting)  // "Hello, World!"
```

## Web Worker Communication

### Main Thread

```typescript
// main.ts
import { newMessagePortRpcSession } from 'capnweb'

const worker = new Worker('./worker.ts', { type: 'module' })

// Create channel for RPC
const channel = new MessageChannel()

// Send one port to worker
worker.postMessage({ type: 'init', port: channel.port2 }, [channel.port2])

// Use other port for RPC
using api = newMessagePortRpcSession<WorkerApi>(channel.port1)

const result = await api.heavyComputation(data)
console.log('Result:', result)
```

### Worker Thread

```typescript
// worker.ts
import { newMessagePortRpcSession, RpcTarget } from 'capnweb'

class WorkerApi extends RpcTarget {
  heavyComputation(data: number[]): number {
    // CPU-intensive work
    return data.reduce((sum, n) => sum + n, 0)
  }
}

self.onmessage = (event) => {
  if (event.data.type === 'init') {
    // Receive port and set up RPC
    newMessagePortRpcSession(event.data.port, new WorkerApi())
  }
}
```

## iframe Communication

### Parent Window

```typescript
// parent.ts
import { newMessagePortRpcSession } from 'capnweb'

const iframe = document.getElementById('my-iframe') as HTMLIFrameElement

// Wait for iframe to load
await new Promise(resolve => iframe.onload = resolve)

// Create channel
const channel = new MessageChannel()

// Send port to iframe
iframe.contentWindow!.postMessage({ type: 'rpc-init', port: channel.port2 }, '*', [channel.port2])

// Use RPC
using api = newMessagePortRpcSession<IframeApi>(channel.port1)
const data = await api.getData()
```

### iframe

```typescript
// iframe.ts
import { newMessagePortRpcSession, RpcTarget } from 'capnweb'

class IframeApi extends RpcTarget {
  getData(): any {
    return { value: 42 }
  }
}

window.onmessage = (event) => {
  if (event.data.type === 'rpc-init') {
    newMessagePortRpcSession(event.data.port, new IframeApi())
  }
}
```

## Bidirectional Communication

Both sides can expose APIs:

### Main Thread

```typescript
// Main thread API for worker to call
class MainApi extends RpcTarget {
  updateUI(message: string): void {
    document.getElementById('status')!.textContent = message
  }

  getConfig(): Config {
    return globalConfig
  }
}

const mainApi = new MainApi()

// Create channel and send port to worker
const channel = new MessageChannel()
worker.postMessage({ port: channel.port2 }, [channel.port2])

// Set up RPC with local API
using workerApi = newMessagePortRpcSession<WorkerApi>(channel.port1, mainApi)
```

### Worker Thread

```typescript
class WorkerApi extends RpcTarget {
  private mainApi?: RpcStub<MainApi>

  setMainApi(api: RpcStub<MainApi>): void {
    this.mainApi = api
  }

  async processData(data: any): Promise<Result> {
    // Call back to main thread
    await this.mainApi?.updateUI('Processing...')

    const result = await heavyProcessing(data)

    await this.mainApi?.updateUI('Done!')
    return result
  }
}

self.onmessage = async (event) => {
  const workerApi = new WorkerApi()

  // Create session with bidirectional access
  using mainApi = newMessagePortRpcSession<MainApi>(event.data.port, workerApi)

  // Store reference to main API
  workerApi.setMainApi(mainApi)
}
```

## SharedWorker Communication

```typescript
// shared-worker.ts
import { newMessagePortRpcSession, RpcTarget } from 'capnweb'

class SharedApi extends RpcTarget {
  private counter = 0

  increment(): number {
    return ++this.counter
  }

  getCount(): number {
    return this.counter
  }
}

const api = new SharedApi()

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0]
  newMessagePortRpcSession(port, api)
}
```

```typescript
// client.ts
const worker = new SharedWorker('./shared-worker.ts', { type: 'module' })

using api = newMessagePortRpcSession<SharedApi>(worker.port)
await api.increment()
console.log(await api.getCount())
```

## Service Worker Communication

```typescript
// client.ts
const registration = await navigator.serviceWorker.ready
const channel = new MessageChannel()

registration.active!.postMessage({ type: 'rpc', port: channel.port2 }, [channel.port2])

using api = newMessagePortRpcSession<ServiceWorkerApi>(channel.port1)
const cachedData = await api.getCachedData('key')
```

```typescript
// service-worker.ts
class ServiceWorkerApi extends RpcTarget {
  async getCachedData(key: string): Promise<any> {
    const cache = await caches.open('my-cache')
    const response = await cache.match(key)
    return response?.json()
  }
}

self.addEventListener('message', (event) => {
  if (event.data.type === 'rpc') {
    newMessagePortRpcSession(event.data.port, new ServiceWorkerApi())
  }
})
```

## Security Considerations

### Never Use Window Directly

```typescript
// WRONG: Anyone can postMessage to a window
window.addEventListener('message', (event) => {
  // Can't trust event.origin reliably
})

// CORRECT: Use MessageChannel
const channel = new MessageChannel()
// Only code with access to port2 can communicate
```

### Validate Port Source

```typescript
window.addEventListener('message', (event) => {
  // Verify the message is from expected origin
  if (event.origin !== 'https://trusted-site.com') {
    return
  }

  // Only accept port from trusted source
  if (event.data.type === 'rpc-init' && event.ports[0]) {
    newMessagePortRpcSession(event.ports[0], new MyApi())
  }
})
```

### Transferable Objects

MessagePorts must be transferred, not cloned:

```typescript
// CORRECT: Transfer port in transfer list
otherContext.postMessage({ port }, [port])

// WRONG: Port not transferred
otherContext.postMessage({ port })  // Error!
```

## Promise Pipelining

MessagePort sessions support full promise pipelining:

```typescript
using api = newMessagePortRpcSession<WorkerApi>(port)

// Pipeline calls
const data = api.fetchData()
const processed = api.process(data)
const result = await api.format(processed)

// All executed in worker, results returned together
```

## Error Handling

```typescript
using api = newMessagePortRpcSession<WorkerApi>(port)

api.onRpcBroken((error) => {
  console.error('Worker connection lost:', error)
})

try {
  await api.method()
} catch (error) {
  console.error('RPC error:', error)
}
```

## Performance Tips

### 1. Transfer Large Data

```typescript
class WorkerApi extends RpcTarget {
  processBuffer(buffer: ArrayBuffer): ArrayBuffer {
    // Process and return
    return processedBuffer
  }
}

// Transfer buffer ownership (zero-copy)
worker.postMessage({ buffer }, [buffer])
```

### 2. Batch Related Operations

```typescript
using api = newMessagePortRpcSession<WorkerApi>(port)

// Good: Batch related calls
const results = await Promise.all([
  api.process(data1),
  api.process(data2),
  api.process(data3)
])
```

### 3. Keep Workers Alive

```typescript
// Create worker once
const worker = new Worker('./worker.ts')
const channel = new MessageChannel()
worker.postMessage({ port: channel.port2 }, [channel.port2])
const api = newMessagePortRpcSession<WorkerApi>(channel.port1)

// Reuse for multiple operations
await api.operation1()
await api.operation2()
// Don't dispose until completely done
```
