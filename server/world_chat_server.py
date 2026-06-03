#!/usr/bin/env python3
"""API-key protected world chat server for CoreSapian multiplayer sessions.

Protocol:
- WebSocket endpoint: /ws/world-chat?api_key=<key>&username=<display_name>
- Incoming message payload: plain text (one chat message)
- Outgoing payload: JSON string with fields:
  {
    "type": "system" | "chat",
    "timestamp": "ISO-8601 UTC",
    "username": "player name",
    "message": "content"
  }
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Set
from urllib.parse import parse_qs, urlparse

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed


@dataclass(frozen=True)
class Client:
    websocket: ServerConnection
    username: str


class WorldChatServer:
    def __init__(self, api_keys: set[str], max_message_length: int = 512) -> None:
        self._api_keys = api_keys
        self._max_message_length = max_message_length
        self._clients: Set[Client] = set()

    async def handler(self, websocket: ServerConnection) -> None:
        parsed = urlparse(websocket.request.path)
        if parsed.path != "/ws/world-chat":
            await websocket.close(code=1008, reason="Invalid WebSocket path")
            return

        query = parse_qs(parsed.query)
        api_key = (query.get("api_key") or [""])[0].strip()
        username = (query.get("username") or [""])[0].strip()

        if api_key not in self._api_keys:
            await websocket.close(code=1008, reason="Invalid API key")
            return

        if not username:
            await websocket.close(code=1008, reason="Username is required")
            return

        username = username[:32]
        client = Client(websocket=websocket, username=username)
        self._clients.add(client)

        await self._broadcast(
            {
                "type": "system",
                "timestamp": self._timestamp(),
                "username": "server",
                "message": f"{username} joined the world chat.",
            }
        )

        try:
            async for raw_message in websocket:
                message = raw_message.strip()
                if not message:
                    continue

                if len(message) > self._max_message_length:
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "system",
                                "timestamp": self._timestamp(),
                                "username": "server",
                                "message": (
                                    f"Message too long ({len(message)} chars). "
                                    f"Max: {self._max_message_length}."
                                ),
                            }
                        )
                    )
                    continue

                await self._broadcast(
                    {
                        "type": "chat",
                        "timestamp": self._timestamp(),
                        "username": username,
                        "message": message,
                    }
                )
        except ConnectionClosed:
            pass
        finally:
            self._clients.discard(client)
            await self._broadcast(
                {
                    "type": "system",
                    "timestamp": self._timestamp(),
                    "username": "server",
                    "message": f"{username} left the world chat.",
                }
            )

    async def _broadcast(self, payload: dict[str, str]) -> None:
        message = json.dumps(payload)
        stale_clients: list[Client] = []

        for client in self._clients:
            try:
                await client.websocket.send(message)
            except ConnectionClosed:
                stale_clients.append(client)

        for client in stale_clients:
            self._clients.discard(client)

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).isoformat()


def load_api_keys(raw_value: str | None) -> set[str]:
    if not raw_value:
        return set()
    return {chunk.strip() for chunk in raw_value.split(",") if chunk.strip()}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CoreSapian world chat server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=8765, help="Bind port")
    parser.add_argument(
        "--api-keys",
        default=os.getenv("CORE_CHAT_API_KEYS", ""),
        help=(
            "Comma-separated API keys. Defaults to CORE_CHAT_API_KEYS env var. "
            "At least one key is required."
        ),
    )
    parser.add_argument(
        "--max-message-length",
        type=int,
        default=512,
        help="Maximum accepted chat message length",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    api_keys = load_api_keys(args.api_keys)

    if not api_keys:
        raise SystemExit(
            "No API keys configured. Pass --api-keys or set CORE_CHAT_API_KEYS."
        )

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    server = WorldChatServer(api_keys=api_keys, max_message_length=args.max_message_length)

    async with serve(server.handler, args.host, args.port):
        logging.info("World chat server running on ws://%s:%s/ws/world-chat", args.host, args.port)
        await asyncio.Event().wait()  # Run forever.


if __name__ == "__main__":
    asyncio.run(main())
