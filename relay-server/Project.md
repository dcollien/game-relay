## Game Relay Server:

Stack: FastAPI, uv

env variable: SERVER_URL

/connect/{game_code}/{mode}

This hashes the game_code, and turns it into an index for a list of known servers. If the game code does not map to the current SERVER_URL, redirect to the mapped SERVER_URL

Otherwise:

'mode' can be either "host" or "client"

If host:
 - ensure there's not already another host connected, if so respond with an error ("game already has a host" error)
 - start a "game" (in memory)
 - open websocket
 - send back a "connected" message

if client:
 - open websocket
 - check if a game exists yet
    - No: send back a "waiting" message until the game is created, then...
    - Yes: send back a "connected" message

Once the connection is established:
Each client has an RPC with the Host.
A client sends a message with their client ID, message ID, a name (endpoint name), and a payload. The host receives this and responds to that client's message with a return value (response message to that client ID and message ID with its own payload)
