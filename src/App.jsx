
import { useEffect, useRef, useState } from 'react'
import './App.css'

function App() {
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('esmFamilPlayerName') || ''
  )

  const [page, setPage] = useState('home')
  const [roomCode, setRoomCode] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [players, setPlayers] = useState([])
  const [playerId, setPlayerId] = useState('')
  const [error, setError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('')

  const wsRef = useRef(null)
  const pendingMessagesRef = useRef([])

  function connectAndSend(message) {
    const existingSocket = wsRef.current

    if (existingSocket?.readyState === WebSocket.OPEN) {
      existingSocket.send(JSON.stringify(message))
      return
    }

    pendingMessagesRef.current.push(message)

    if (existingSocket?.readyState === WebSocket.CONNECTING) {
      return
    }

    const protocol =
      window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/ws`
    )

    wsRef.current = socket
    setConnectionStatus('در حال اتصال به سرور...')

    socket.onopen = () => {
      setConnectionStatus('متصل به سرور')

      const messages = pendingMessagesRef.current
      pendingMessagesRef.current = []

      messages.forEach((item) => {
        socket.send(JSON.stringify(item))
      })
    }

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'connected') {
          return
        }

        if (message.type === 'room_created' ||
            message.type === 'joined_room') {
          setRoomCode(message.room.code)
          setPlayers(message.room.players)
          setPlayerId(message.playerId)
          setPage('room')
          setError('')
          return
        }

        if (message.type === 'room_state') {
          setRoomCode(message.room.code)
          setPlayers(message.room.players)

          if (message.room.status === 'playing') {
            setPage('game')
          }

          return
        }

        if (message.type === 'error') {
          setError(message.message)
          return
        }

        if (message.type === 'kicked') {
          setError(message.message)
          setPage('home')
          setRoomCode('')
          setPlayers([])
          setPlayerId('')
          return
        }

        if (message.type === 'room_closed') {
          setError(message.message)
          setPage('home')
          setRoomCode('')
          setPlayers([])
          setPlayerId('')
        }
      } catch {
        setError('پاسخ سرور قابل خواندن نیست.')
      }
    }

    socket.onerror = () => {
      setError('اتصال به سرور برقرار نشد. اتصال و تنظیمات سرور را بررسی کن.')
    }

    socket.onclose = () => {
      if (wsRef.current === socket) {
        wsRef.current = null
        setConnectionStatus('اتصال قطع شد')
      }
    }
  }

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

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

    setError('')

    connectAndSend({
      type: 'create_room',
      name: playerName.trim(),
    })
  }

  function joinRoom() {
    if (!playerName.trim()) {
      setError('لطفاً اول اسم خود را وارد کنید.')
      return
    }

    if (!/^\d{4}$/.test(roomCodeInput)) {
      setError('کد اتاق باید دقیقاً ۴ رقم باشد.')
      return
    }

    setError('')

    connectAndSend({
      type: 'join_room',
      name: playerName.trim(),
      code: roomCodeInput,
    })
  }

  function kickPlayer(id) {
    connectAndSend({
      type: 'kick_player',
      playerId: id,
    })
  }

  function startGame() {
    connectAndSend({
      type: 'start_game',
    })
  }

  function copyRoomCode() {
    navigator.clipboard.writeText(roomCode)
      .then(() => setError('کد اتاق کپی شد.'))
      .catch(() => setError('کپی خودکار انجام نشد؛ کد را دستی کپی کن.'))
  }

  function backToHome() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave_room' }))
    }

    setPage('home')
    setRoomCode('')
    setPlayers([])
    setPlayerId('')
    setError('')
  }

  const isHost = players.some(
    (player) => player.id === playerId && player.isHost
  )

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

            <label htmlFor="roomCodeInput">
              کد اتاق دوستانت (۴ رقم)
            </label>

            <input
              id="roomCodeInput"
              type="text"
              inputMode="numeric"
              placeholder="مثلاً 4821"
              value={roomCodeInput}
              onChange={(e) =>
                setRoomCodeInput(
                  e.target.value.replace(/\D/g, '').slice(0, 4)
                )
              }
              maxLength={4}
            />

            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}

            {connectionStatus && (
              <p className="room-note">{connectionStatus}</p>
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
            disabled={!playerName.trim()}
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
            disabled={!playerName.trim() || roomCodeInput.length !== 4}
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

            <strong className="room-code">{roomCode}</strong>

            <button className="copy-button" onClick={copyRoomCode}>
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
                        <small>{player.isHost ? 'Host' : 'Player'}</small>
                      </div>

                      {player.isHost ? (
                        <span className="host-badge">HOST</span>
                      ) : isHost ? (
                        <button
                          className="kick-button"
                          title="Remove player"
                          onClick={() => kickPlayer(player.id)}
                        >
                          ✕
                        </button>
                      ) : null}
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

          {error && (
            <p className="error-message" role="alert">{error}</p>
          )}

          {isHost && (
            <button className="start-button" onClick={startGame}>
              Start Game <span>→</span>
            </button>
          )}

          <button className="back-button" onClick={backToHome}>
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

          <p className="room-note">Room code: {roomCode}</p>

          <button
            className="menu-button join-button"
            onClick={() => setPage('room')}
          >
            Back to Room
          </button>
        </main>
      )}

      <footer>Made for friends, made for fun.</footer>
    </div>
  )
}

export default App
