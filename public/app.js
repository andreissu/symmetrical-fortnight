const playerForm = document.getElementById('player-join-form');
const playerError = document.getElementById('player-error');
const playerStatusCard = document.getElementById('player-status');
const playerDisplayName = document.getElementById('player-display-name');
const playerRole = document.getElementById('player-role');
const playerAlive = document.getElementById('player-alive');
const playerNameInput = document.getElementById('player-name-input');
const playerSessionCodeInput = document.getElementById('player-session-code');
const playerRosterCard = document.getElementById('player-roster');
const playerRosterList = document.getElementById('player-roster-list');

const hostForm = document.getElementById('host-create-form');
const hostError = document.getElementById('host-error');
const hostDetails = document.getElementById('host-details');
const hostSessionCode = document.getElementById('host-session-code');
const hostSecretEl = document.getElementById('host-secret');
const hostPlayersCard = document.getElementById('host-players');
const playersList = document.getElementById('players-list');
const roleForm = document.getElementById('role-randomiser-form');
const rolePoolInput = document.getElementById('role-pool');
const roleFeedback = document.getElementById('role-feedback');
const clearRolesButton = document.getElementById('clear-roles');

let playerEventSource = null;
let hostEventSource = null;

const playerState = {
  code: null,
  playerId: null,
  name: null,
};

const hostState = {
  code: null,
  secret: null,
};

function uppercaseCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

playerSessionCodeInput.addEventListener('input', () => {
  playerSessionCodeInput.value = uppercaseCode(playerSessionCodeInput.value);
});

playerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = uppercaseCode(playerSessionCodeInput.value);
  const name = playerNameInput.value.trim();
  playerError.textContent = '';

  if (!code || code.length !== 5) {
    playerError.textContent = 'Enter the 5 character session code.';
    return;
  }
  if (!name) {
    playerError.textContent = 'Your name is required.';
    return;
  }

  try {
    const response = await fetch(`/api/sessions/${code}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to join session.' }));
      playerError.textContent = error.error || 'Unable to join session.';
      return;
    }
    const data = await response.json();
    playerState.code = data.code;
    playerState.playerId = data.playerId;
    playerState.name = data.name;

    playerDisplayName.textContent = data.name;
    playerRole.textContent = 'Waiting for storyteller…';
    playerAlive.textContent = 'Alive';
    playerAlive.classList.remove('dead');
    playerAlive.classList.add('alive');
    playerStatusCard.classList.remove('hidden');
    playerRosterCard.classList.remove('hidden');
    renderRoster([]);

    playerForm.querySelector('button').disabled = true;
    playerSessionCodeInput.disabled = true;
    playerNameInput.disabled = true;

    connectPlayerStream();
  } catch (err) {
    console.error(err);
    playerError.textContent = 'Network error joining session. Try again.';
  }
});

function connectPlayerStream() {
  if (!playerState.code || !playerState.playerId) {
    return;
  }
  if (playerEventSource) {
    playerEventSource.close();
  }
  const url = `/api/sessions/${playerState.code}/stream?playerId=${encodeURIComponent(
    playerState.playerId
  )}`;
  playerEventSource = new EventSource(url);
  playerEventSource.onopen = () => {
    playerError.textContent = '';
  };
  playerEventSource.addEventListener('player_state', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.missing) {
        playerError.textContent = 'The server no longer recognises this player. Rejoin the session.';
        return;
      }
      if (typeof data.role === 'string' && data.role.trim() !== '') {
        playerRole.textContent = data.role;
      } else {
        playerRole.textContent = 'Waiting for storyteller…';
      }
      if (data.alive) {
        playerAlive.textContent = 'Alive';
        playerAlive.classList.remove('dead');
        playerAlive.classList.add('alive');
      } else {
        playerAlive.textContent = 'Dead';
        playerAlive.classList.remove('alive');
        playerAlive.classList.add('dead');
      }
    } catch (err) {
      console.error('Failed to parse player event', err);
    }
  });
  playerEventSource.addEventListener('roster_update', (event) => {
    try {
      const data = JSON.parse(event.data);
      renderRoster(data.roster || []);
    } catch (err) {
      console.error('Failed to parse roster event', err);
    }
  });
  playerEventSource.onerror = () => {
    playerError.textContent = 'Connection lost. Retrying…';
  };
}

hostForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hostError.textContent = '';
  try {
    const response = await fetch('/api/sessions', { method: 'POST' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to create session.' }));
      hostError.textContent = error.error || 'Unable to create session.';
      return;
    }
    const data = await response.json();
    hostState.code = data.code;
    hostState.secret = data.hostSecret;
    hostSessionCode.textContent = data.code;
    hostSecretEl.textContent = data.hostSecret;
    hostDetails.classList.remove('hidden');
    hostPlayersCard.classList.remove('hidden');
    connectHostStream();
  } catch (err) {
    console.error(err);
    hostError.textContent = 'Network error creating session. Try again.';
  }
});

function connectHostStream() {
  if (!hostState.code || !hostState.secret) {
    return;
  }
  if (hostEventSource) {
    hostEventSource.close();
  }
  const url = `/api/sessions/${hostState.code}/host-stream?hostSecret=${encodeURIComponent(
    hostState.secret
  )}`;
  hostEventSource = new EventSource(url);
  hostEventSource.onopen = () => {
    hostError.textContent = '';
  };
  hostEventSource.addEventListener('session_update', (event) => {
    try {
      const data = JSON.parse(event.data);
      renderPlayers(data.players || []);
    } catch (err) {
      console.error('Failed to parse host event', err);
    }
  });
  hostEventSource.onerror = () => {
    hostError.textContent = 'Connection lost. Retrying…';
  };
}

if (roleForm) {
  roleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (roleFeedback) {
      roleFeedback.textContent = '';
    }
    hostError.textContent = '';

    if (!hostState.code || !hostState.secret) {
      hostError.textContent = 'Create a session before assigning roles.';
      return;
    }

    if (!rolePoolInput) {
      hostError.textContent = 'Roles input unavailable. Refresh and try again.';
      return;
    }

    const roles = parseRolePool(rolePoolInput.value);
    if (roles.length === 0) {
      if (roleFeedback) {
        roleFeedback.textContent = 'Enter at least one role to randomise.';
      }
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${hostState.code}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostSecret: hostState.secret,
          roles,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unable to assign roles.' }));
        hostError.textContent = error.error || 'Unable to assign roles.';
        return;
      }
      const result = await response.json().catch(() => ({ ok: true }));
      if (roleFeedback) {
        if (typeof result.assigned === 'number') {
          roleFeedback.textContent = `Assigned ${result.assigned} role${
            result.assigned === 1 ? '' : 's'
          } randomly.`;
        } else {
          roleFeedback.textContent = 'Roles assigned randomly.';
        }
      }
    } catch (err) {
      console.error(err);
      hostError.textContent = 'Network error assigning roles.';
    }
  });
}

if (clearRolesButton) {
  clearRolesButton.addEventListener('click', () => {
    if (rolePoolInput) {
      rolePoolInput.value = '';
    }
    if (roleFeedback) {
      roleFeedback.textContent = '';
    }
  });
}

function parseRolePool(value) {
  if (!value) return [];
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function renderPlayers(players) {
  playersList.innerHTML = '';
  if (!players || players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Waiting for players to join.';
    playersList.appendChild(empty);
    return;
  }

  players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'player-row';

    const header = document.createElement('header');
    const nameEl = document.createElement('span');
    nameEl.className = 'player-name';
    nameEl.textContent = player.name;
    const status = document.createElement('span');
    status.className = 'player-status';
    const dot = document.createElement('span');
    dot.className = `status-indicator ${player.alive ? 'alive' : 'dead'}`;
    const statusLabel = document.createElement('span');
    statusLabel.textContent = player.alive ? 'Alive' : 'Dead';
    status.appendChild(dot);
    status.appendChild(statusLabel);

    header.appendChild(nameEl);
    header.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'player-actions';
    const roleInput = document.createElement('input');
    roleInput.type = 'text';
    roleInput.placeholder = 'Role';
    roleInput.value = player.role || '';
    const saveRole = document.createElement('button');
    saveRole.type = 'button';
    saveRole.textContent = 'Save role';
    saveRole.addEventListener('click', async () => {
      await updateRole(player.id, roleInput.value);
    });

    const markAlive = document.createElement('button');
    markAlive.type = 'button';
    markAlive.textContent = 'Mark alive';
    markAlive.classList.add('secondary');
    markAlive.addEventListener('click', async () => {
      await updateAlive(player.id, true);
    });

    const markDead = document.createElement('button');
    markDead.type = 'button';
    markDead.textContent = 'Mark dead';
    markDead.classList.add('secondary');
    markDead.addEventListener('click', async () => {
      await updateAlive(player.id, false);
    });

    actions.appendChild(roleInput);
    actions.appendChild(saveRole);
    actions.appendChild(markAlive);
    actions.appendChild(markDead);

    row.appendChild(header);
    row.appendChild(actions);
    playersList.appendChild(row);
  });
}

async function updateRole(playerId, roleValue) {
  hostError.textContent = '';
  try {
    const response = await fetch(`/api/sessions/${hostState.code}/roles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostSecret: hostState.secret,
        assignments: [
          {
            playerId,
            role: roleValue,
          },
        ],
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to update role.' }));
      hostError.textContent = error.error || 'Unable to update role.';
    }
  } catch (err) {
    console.error(err);
    hostError.textContent = 'Network error updating role.';
  }
}

async function updateAlive(playerId, alive) {
  hostError.textContent = '';
  try {
    const response = await fetch(`/api/sessions/${hostState.code}/players/${playerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostSecret: hostState.secret,
        alive,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to update player.' }));
      hostError.textContent = error.error || 'Unable to update player.';
    }
  } catch (err) {
    console.error(err);
    hostError.textContent = 'Network error updating player.';
  }
}

function renderRoster(roster) {
  if (!playerRosterCard || !playerRosterList) return;
  playerRosterList.innerHTML = '';
  if (!Array.isArray(roster) || roster.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'hint';
    empty.textContent = 'Waiting for players to join…';
    playerRosterList.appendChild(empty);
    return;
  }

  roster.forEach((entry) => {
    const item = document.createElement('li');
    item.className = `roster-item ${entry.alive ? 'alive' : 'dead'}`;
    if (entry.id === playerState.playerId) {
      item.classList.add('you');
    }

    const name = document.createElement('span');
    name.className = 'label';
    name.textContent = entry.name;
    if (entry.id === playerState.playerId) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'You';
      name.appendChild(badge);
    }

    const status = document.createElement('span');
    status.textContent = entry.alive ? 'Alive' : 'Dead';

    item.appendChild(name);
    item.appendChild(status);
    playerRosterList.appendChild(item);
  });
}
