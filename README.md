# Mafia Session Manager

A lightweight web application for running social deduction games like Mafia. It lets a storyteller create a session, assign hidden roles to players, and mark players as dead during the game. Players receive private updates right on their phones using server-sent events—no page refresh required.

## Features

- 🎲 **Session creation** – storyteller spins up a unique join code and a private host secret.
- 🙋 **Player onboarding** – players enter the code and instantly receive their role and status.
- 🧙 **Role control** – storyteller assigns or updates roles with a couple of taps.
- ☠️ **Life tracking** – toggle players between alive/dead states and push updates immediately.
- ⚡ **Realtime sync** – powered by Server-Sent Events (no external dependencies required).

## Getting started

The app has no external runtime dependencies beyond Node.js (v18+ recommended).

```bash
npm install # not required, but keeps npm happy
npm start
```

By default the server listens on [http://localhost:3000](http://localhost:3000). Open that address in multiple browser tabs or devices to simulate a game.

### Development tips

- Sessions are stored in memory; restarting the server clears all games.
- Keep the host secret somewhere safe—if you refresh the storyteller view you can reconnect using the same secret by extending the UI or creating a new session.
- The client UI is intentionally minimal. You can customise `public/app.js` and `public/styles.css` to match your group’s vibe.

## Project structure

```
.
├── public/
│   ├── app.js        # Front-end logic for players and storyteller
│   ├── index.html    # Single-page interface
│   └── styles.css    # Tailored mobile-friendly styles
├── server.js         # Node HTTP server with API + SSE endpoints
├── package.json      # npm scripts and metadata
└── README.md
```

## License

MIT
