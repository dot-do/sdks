"""
{{Name}}.do client implementation.
"""

from __future__ import annotations

from typing import Any, Optional

from rpc_do import connect, RpcClient


class {{Name}}Client:
    """
    {{Name}}.do client for interacting with the {{name}} service.

    Args:
        api_key: API key for authentication
        base_url: Base URL for the service (defaults to https://{{name}}.do)

    Example:
        >>> client = {{Name}}Client(api_key="your-api-key")
        >>> rpc = await client.connect()
        >>> result = await rpc.example()
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://{{name}}.do",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self._rpc: Optional[RpcClient] = None

    async def connect(self) -> RpcClient:
        """
        Connect to the {{name}}.do service.

        Returns:
            RpcClient: The connected RPC client
        """
        if self._rpc is None:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self._rpc = await connect(self.base_url, headers=headers)
        return self._rpc

    async def disconnect(self) -> None:
        """
        Disconnect from the service.
        """
        if self._rpc is not None:
            # Close connection if supported
            self._rpc = None


__all__ = ["{{Name}}Client"]
