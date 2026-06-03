#!/usr/bin/env python3
"""
ENet-to-WebSocket Relay for CoreSapian.

Browser-based Godot clients (WASM) cannot use raw ENet TCP connections.
This relay sits between the Godot dedicated server (ENet TCP :7001)
and browser clients (WebSocket :7000/ws/enet), forwarding packets bidirectionally.

Run as a systemd service alongside the Godot server.
"""

from __future__ import annotations

import asyncio
import logging
import os
from urllib.parse import urlparse

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [ENet-Relay] %(message)s"
)
log = logging.getLogger("enet-relay")

ENET_SERVER_HOST = os.environ.get("ENET_SERVER_HOST", "127.0.0.1")
ENET_SERVER_PORT = int(os.environ.get("ENET_SERVER_PORT", "7001"))
WS_LISTEN_PORT = int(os.environ.get("WS_LISTEN_PORT", "7000"))
WS_PATH = "/ws/enet"


class ENetBridge:
    """Bridges a single WebSocket client to the ENet server."""

    def __init__(self, ws_client: ServerConnection) -> None:
        self.ws = ws_client
        self.tcp_reader: asyncio.StreamReader | None = None
        self.tcp_writer: asyncio.StreamWriter | None = None

    async def connect_enet(self) -> None:
        """Open a TCP connection to the ENet server."""
        reader, writer = await asyncio.open_connection(
            ENET_SERVER_HOST, ENET_SERVER_PORT
        )
        self.tcp_reader = reader
        self.tcp_writer = writer
        log.info("Connected to ENet server %s:%d", ENET_SERVER_HOST, ENET_SERVER_PORT)

    async def ws_to_tcp(self) -> None:
        """Forward messages from WebSocket to ENet TCP."""
        try:
            async for message in self.ws:
                if isinstance(message, bytes) and self.tcp_writer:
                    self.tcp_writer.write(message)
                    await self.tcp_writer.drain()
        except ConnectionClosed:
            log.info("WebSocket client disconnected")
        finally:
            if self.tcp_writer:
                self.tcp_writer.close()

    async def tcp_to_ws(self) -> None:
        """Forward data from ENet TCP to WebSocket."""
        try:
            while self.tcp_reader:
                data = await self.tcp_reader.read(4096)
                if not data:
                    break
                await self.ws.send(data)
        except asyncio.CancelledError:
            pass
        finally:
            await self.ws.close()

    async def run(self) -> None:
        await self.connect_enet()
        await asyncio.gather(self.ws_to_tcp(), self.tcp_to_ws())


async def handler(websocket: ServerConnection) -> None:
    parsed = urlparse(websocket.request.path)
    if parsed.path != WS_PATH:
        await websocket.close(code=1008, reason="Invalid WebSocket path")
        return

    log.info("New WS client from %s", websocket.remote_address)
    bridge = ENetBridge(websocket)
    try:
        await bridge.run()
    except ConnectionClosed:
        log.info("Client disconnected normally: %s", websocket.remote_address)
    except Exception:
        log.exception("Unexpected bridge error")


async def main() -> None:
    log.info("Starting ENet-WebSocket relay on :%d%s", WS_LISTEN_PORT, WS_PATH)
    async with serve(handler, "0.0.0.0", WS_LISTEN_PORT):
        await asyncio.Event().wait()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
