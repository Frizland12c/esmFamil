import { useState } from 'react'
import './App.css'

function App() {
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('esmFamilPlayerName') || ''
  )

  const [page, setPage] = useState('home')
  const [roomCode, setRoomCode] = useState('')
  const [players, setPlayers] = useState([])
  const [error, setError] = useState('')

  function handleNameChange(e) {
    const name = e.target.value

    setPlayerName(name)
    localStorage.setItem('esmFamilPlayerName', name)
    setError('')
  }

  function createRoom() {
    if (!playerName.trim()) {
      setError('لطفاً اول اسم خود را وارد کنید.')
      return
    }

    const newCode = String(
      Math.floor(10000 + Math.random() * 90000)
    )

    setRoomCode(newCode)

    setPlayers([
      {
        id: 1,
        name: playerName.trim(),
        isHost: true,
      },
    ])

    setError('')
    setPage('room')
  }

  function joinRoom() {
    if (!playerName.trim()) {
      setError('لطفاً اول اسم خود را وارد کنید.')
      return
    }

    setError('اتصال بازیکنان دیگر را در مرحله بعد پیاده‌سازی می‌کنیم.')
  }

  function kickPlayer(playerId) {
    setPlayers((currentPlayers) =>
      currentPlayers.filter((player) => player.id !== playerId)
    )
  }

  function startGame() {
    setPage('game')
  }

  function copyRoomCode() {
    navigator.clipboard.writeText(roomCode)
    setError('')
  }

  return (
    <div className="app">
      <header className="header">
        <h1 dir="rtl">اسم فامیل</h1>
        <p>The ultimate word game</p>
      </header>

      {page === 'home' && (
        <main className="menu-card">
          <div className="player-section">
            <label htmlFor="playerName">
              اسم خودت رو وارد کن
            </label>

            <input
              id="playerName"
              type="text"
              placeholder="مثلاً علی..."
              value={playerName}
              onChange={handleNameChange}
              maxLength={20}
              autoComplete="nickname"
            />

            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="game-icon">🎮</div>

          <h2>Let's Play!</h2>

          <p className="description">
            Create a room or join your friends
          </p>

          <button
            className="menu-button create-button"
            onClick={createRoom}
          >
            <span className="button-icon">＋</span>
            <span>
              <strong>Create Room</strong>
              <small>Start a new game with friends</small>
            </span>
            <span className="arrow">→</span>
          </button>

          <button
            className="menu-button join-button"
            onClick={joinRoom}
          >
            <span className="button-icon">↗</span>
            <span>
              <strong>Join Room</strong>
              <small>Enter a friend's room</small>
            </span>
            <span className="arrow">→</span>
          </button>
        </main>
      )}

      {page === 'room' && (
        <main className="room-card">
          <div className="room-top">
            <h2>Game Room</h2>
            <p>Waiting for players to join...</p>
          </div>

          <div className="room-code-box">
            <span>ROOM CODE</span>

            <strong className="room-code">
              {roomCode}
            </strong>

            <button
              className="copy-button"
              onClick={copyRoomCode}
            >
              Copy Code
            </button>
          </div>

          <div className="players-heading">
            <h3>Players</h3>
            <span>{players.length} / 15</span>
          </div>

          <div className="players-grid">
            {Array.from({ length: 15 }, (_, index) => {
              const player = players[index]

              return (
                <div className="player-slot" key={index}>
                  {player ? (
                    <>
                      <div className="player-avatar">
                        {player.name.charAt(0).toUpperCase()}
                      </div>

                      <div className="player-info">
                        <strong>{player.name}</strong>

                        <small>
                          {player.isHost ? 'Host' : 'Player'}
                        </small>
                      </div>

                      {player.isHost ? (
                        <span className="host-badge">
                          HOST
                        </span>
                      ) : (
                        <button
                          className="kick-button"
                          title="Remove player"
                          onClick={() => kickPlayer(player.id)}
                        >
                          ✕
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="empty-slot">
                      <span>＋</span>
                      <small>Waiting...</small>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="room-note">
            Share the room code with your friends.
          </p>

          <button
            className="start-button"
            onClick={startGame}
          >
            Start Game <span>→</span>
          </button>

          <button
            className="back-button"
            onClick={() => setPage('home')}
          >
            ← Back to Home
          </button>
        </main>
      )}

      {page === 'game' && (
        <main className="menu-card game-page">
          <div className="game-icon">🎉</div>

          <h2>Game Started!</h2>

          <p className="description">
            Welcome to Esm Famil, {playerName}!
          </p>

          <p className="room-note">
            Room code: {roomCode}
          </p>

          <button
            className="menu-button join-button"
            onClick={() => setPage('room')}
          >
            Back to Room
          </button>
        </main>
      )}

      <footer>
        Made for friends, made for fun.
      </footer>
    </div>
  )
}

export default App