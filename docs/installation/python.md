# Python Installation

The Python SDK provides async/await-based access to Cap'n Web RPC.

## Installation

```bash
pip install capnweb
```

Or with Poetry:

```bash
poetry add capnweb
```

## Requirements

- Python 3.10 or later
- `asyncio` support
- `aiohttp` (installed automatically)

## Basic Usage

### Client

```python
import asyncio
import capnweb

async def main():
    # Connect to server
    async with capnweb.connect('wss://api.example.com') as api:
        # Make RPC calls
        greeting = await api.greet('World')
        print(greeting)  # "Hello, World!"

        # Get user data
        user = await api.get_user(123)
        print(f"User: {user['name']}")

asyncio.run(main())
```

### Promise Pipelining

```python
import asyncio
import capnweb

async def main():
    async with capnweb.connect('wss://api.example.com') as api:
        # Pipeline calls in a single round trip
        user = api.get_user(123)  # Don't await yet
        profile = await api.get_profile(user.id)  # Pipelined!

        print(f"Profile: {profile['name']}")

asyncio.run(main())
```

### Authentication Pattern

```python
import asyncio
import capnweb
import os

async def main():
    async with capnweb.connect('wss://api.example.com') as public_api:
        # Authenticate and get authorized API
        token = os.environ['API_TOKEN']
        authed_api = await public_api.authenticate(token)

        # Use authenticated API
        profile = await authed_api.get_profile()
        print(f"Welcome, {profile['name']}!")

asyncio.run(main())
```

## Server Implementation

```python
import asyncio
from aiohttp import web
import capnweb

class MyApi(capnweb.RpcTarget):
    def greet(self, name: str) -> str:
        return f"Hello, {name}!"

    async def get_user(self, user_id: int) -> dict:
        # Async operations supported
        user = await db.get_user(user_id)
        return {
            'id': user.id,
            'name': user.name,
            'email': user.email
        }

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    api = MyApi()
    await capnweb.serve(ws, api)

    return ws

app = web.Application()
app.router.add_get('/api', websocket_handler)

if __name__ == '__main__':
    web.run_app(app, port=8080)
```

## Type Hints

Use type hints for better IDE support:

```python
from typing import TypedDict
import capnweb

class User(TypedDict):
    id: int
    name: str
    email: str

class MyApi(capnweb.RpcTarget):
    def get_user(self, user_id: int) -> User:
        return {
            'id': user_id,
            'name': 'Alice',
            'email': 'alice@example.com'
        }
```

## Error Handling

```python
import asyncio
import capnweb

async def main():
    async with capnweb.connect('wss://api.example.com') as api:
        try:
            result = await api.risky_operation()
        except capnweb.RpcError as e:
            print(f"RPC failed: {e}")
        except capnweb.ConnectionError as e:
            print(f"Connection lost: {e}")

asyncio.run(main())
```

## Configuration Options

```python
import capnweb

# With options
async with capnweb.connect(
    'wss://api.example.com',
    timeout=30.0,  # Connection timeout in seconds
    reconnect=True,  # Auto-reconnect on disconnect
    headers={'X-Custom': 'header'}  # Custom headers (HTTP only)
) as api:
    pass
```

## HTTP Batch Mode

```python
import asyncio
import capnweb

async def main():
    async with capnweb.http_batch('https://api.example.com') as api:
        # All calls are batched into one HTTP request
        greeting1 = api.greet('Alice')  # Don't await
        greeting2 = api.greet('Bob')    # Don't await

        # Batch sent when awaited
        results = await asyncio.gather(greeting1, greeting2)
        print(results)  # ["Hello, Alice!", "Hello, Bob!"]

asyncio.run(main())
```

## Integration with FastAPI

```python
from fastapi import FastAPI, WebSocket
import capnweb

app = FastAPI()

class MyApi(capnweb.RpcTarget):
    def greet(self, name: str) -> str:
        return f"Hello, {name}!"

@app.websocket("/api")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    api = MyApi()
    await capnweb.serve(websocket, api)
```

## Integration with Django Channels

```python
# consumers.py
from channels.generic.websocket import AsyncWebsocketConsumer
import capnweb

class RpcConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        self.api = MyApi()

    async def receive(self, text_data):
        response = await capnweb.handle_message(self.api, text_data)
        await self.send(response)
```

## Troubleshooting

### `asyncio` Errors

Ensure you're using `async with` and `await` correctly:

```python
# WRONG
api = capnweb.connect('wss://...')
result = api.greet('World')

# CORRECT
async with capnweb.connect('wss://...') as api:
    result = await api.greet('World')
```

### Type Errors

Python is dynamically typed. Returned objects are dictionaries, not typed objects:

```python
user = await api.get_user(123)
# user is a dict, not a User object
print(user['name'])  # Use dict access
```

### Connection Timeouts

Increase timeout for slow connections:

```python
async with capnweb.connect('wss://...', timeout=60.0) as api:
    pass
```
