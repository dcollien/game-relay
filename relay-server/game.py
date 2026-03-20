import asyncio
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class ClientConnection:
    websocket: WebSocket
    send_queue: asyncio.Queue = field(
        default_factory=lambda: asyncio.Queue(maxsize=64)
    )


@dataclass
class Game:
    host: WebSocket | None = None
    host_ready: asyncio.Event = field(default_factory=asyncio.Event)
    clients: dict[str, ClientConnection] = field(default_factory=dict)


# Keyed by hashed game_code (hex string)
_games: dict[str, Game] = {}
_lock = asyncio.Lock()


async def get_or_create_game(key: str) -> Game:
    async with _lock:
        if key not in _games:
            _games[key] = Game()
        return _games[key]


async def remove_game(key: str) -> Game | None:
    async with _lock:
        return _games.pop(key, None)


def game_key(game_code: str) -> str:
    import hashlib
    return hashlib.sha256(game_code.encode()).hexdigest()
