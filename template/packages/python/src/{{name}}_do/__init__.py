"""
{{Name}}-DO SDK

{{description}}

Example:
    >>> from {{name}}_do import {{Name}}Client
    >>> client = {{Name}}Client(api_key=os.environ['DOTDO_KEY'])
    >>> result = await client.example()
"""

from .client import {{Name}}Client

__version__ = "0.1.0"
__all__ = ["{{Name}}Client"]
