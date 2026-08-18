from __future__ import annotations

from typing import Any, Awaitable, Callable

from starlette.responses import JSONResponse


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """ASGI request-body limit that also covers chunked/no-Content-Length bodies."""

    def __init__(self, app: Callable[..., Awaitable[Any]], max_bytes: int):
        if max_bytes <= 0:
            raise ValueError("max_bytes must be positive")
        self.app = app
        self.max_bytes = max_bytes

    async def _reject(self, scope, receive, send, status_code: int, detail: str) -> None:
        response = JSONResponse(status_code=status_code, content={"detail": detail})
        await response(scope, receive, send)

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        content_length: str | None = None
        for raw_name, raw_value in scope.get("headers", []):
            if raw_name.lower() == b"content-length":
                content_length = raw_value.decode("latin-1")
                break
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                await self._reject(scope, receive, send, 400, "invalid content-length")
                return
            if declared < 0:
                await self._reject(scope, receive, send, 400, "invalid content-length")
                return
            if declared > self.max_bytes:
                await self._reject(scope, receive, send, 413, "request body too large")
                return

        received = 0
        response_started = False

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge
            return message

        async def tracked_send(message):
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except _BodyTooLarge:
            # Normal API routes consume their body before sending response headers.
            # Guard defensively against trying to send a second response if a future
            # streaming endpoint starts a response before reading its request body.
            if not response_started:
                await self._reject(scope, receive, send, 413, "request body too large")
