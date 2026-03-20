import hashlib
import json
import os
from pathlib import Path

_servers_path = Path(__file__).parent / "servers.json"

with _servers_path.open() as _f:
    SERVERS: list[str] = json.load(_f)

SERVER_URL: str = os.environ.get("SERVER_URL", SERVERS[0])


def get_target_server(game_code: str) -> str:
    """Hash game_code to a stable index and return the corresponding server URL."""
    digest = hashlib.sha256(game_code.encode()).digest()
    index = int.from_bytes(digest[:4], "big") % len(SERVERS)
    return SERVERS[index]


def is_local(game_code: str) -> bool:
    """Return True if this server is responsible for the given game_code."""
    return get_target_server(game_code) == SERVER_URL
