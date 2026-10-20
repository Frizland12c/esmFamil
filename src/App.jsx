
import { useEffect, useRef, useState } from 'react'
import './App.css'

const CATEGORIES = [
  'اسم',
  'فامیل',
  'شهر',
  'کشور',
  'غذا',
  'رنگ',
  'حیوان',
  'ماشین',
  'فیلم یا سریال',
  'اشیاء',
]

const SCORE_OPTIONS = [0, 5, 10, 15, 20]

function emptyAnswers() {
  return Object.fromEntries(
    CATEGORIES.map((category) => [category, ''])
  )
}

function App() {
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('esmFamilPlayerName') || ''
  )

  const [page, setPage] = useState('home')
  const [roomCode, setRoomCode] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [players, setPlayers] = useState([])
  const [playerId, setPlayerId] = useState('')
  const [roomData, setRoomData] = useState(null)
  const [answers, setAnswers] = useState(emptyAnswers)
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

    const socket = new WebSocket(
      'wss://esm-famil-nu.vercel.app/api/ws'
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

        if (message.type === 'connected') return

        if (
          message.type === 'room_created' ||
          message.type === 'joined_room'
        ) {
          setRoomCode(message.room.code)
          setPlayers(message.room.players)
          setPlayerId(message.playerId)
          setRoomData(message.room)
          setPage('room')
          setError('')
          return
        }

        if (message.type === 'room_state') {
          const room = message.room

          setRoomCode(room.code)
          setPlayers(room.players)
          setRoomData(room)

          if (room.status === 'waiting') {
            setPage('room')
          } else if (room.status === 'answering') {
            setPage('game')
          } else if (room.status === 'scoring') {
            setPage('scoring')
          } else if (room.status === 'finished') {
            setPage('results')
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
          setRoomData(null)
          return
        }

        if (message.type === 'room_closed') {
          setError(message.message)
          setPage('home')
          setRoomCode('')
          setPlayers([])
          setPlayerId('')
          setRoomData(null)
        }
      } catch {
        setError('پاسخ سرور قابل خواندن نیست.')
      }
    }

    socket.onerror = () => {
      setError(
        'اتصال به سرور برقرار نشد. اتصال و تنظیمات سرور را بررسی کن.'
      )
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

  // Initialize answers when this player's game letter becomes available.
  useEffect(() => {
    if (roomData?.round && playerId) {
      setAnswers(
        roomData.round.answers?.[playerId] || emptyAnswers()
      )
    }
  }, [roomData?.round?.letter, playerId])

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
    setError('')

    connectAndSend({
      type: 'start_game',
    })
  }

  function copyRoomCode() {
    navigator.clipboard.writeText(roomCode)
      .then(() => setError('کد اتاق کپی شد.'))
      .catch(() =>
        setError('کپی خودکار انجام نشد؛ کد را دستی کپی کن.')
      )
  }

  function backToHome() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'leave_room' })
      )
    }

    setPage('home')
    setRoomCode('')
    setPlayers([])
    setPlayerId('')
    setRoomData(null)
    setAnswers(emptyAnswers())
    setError('')
  }

  function handleAnswerChange(category, value) {
    const updatedAnswers = {
      ...answers,
      [category]: value,
    }

    setAnswers(updatedAnswers)

    connectAndSend({
      type: 'save_answers',
      answers: updatedAnswers,
    })
  }

  function stopGame() {
    if (!roomData?.round || roomData.round.locked) return

    setError('')

    connectAndSend({
      type: 'stop_round',
      answers,
    })
  }

  function giveScore(targetPlayerId, score) {
    connectAndSend({
      type: 'score_category',
      playerId: targetPlayerId,
      score,
    })
  }

  function nextCategory() {
    setError('')

    connectAndSend({
      type: 'next_category',
    })
  }

  const isHost = players.some(
    (player) => player.id === playerId && player.isHost
  )

  const round = roomData?.round
  const currentCategory = round?.categories?.[round.categoryIndex]
  const currentScores = round?.scores?.[round.categoryIndex] || {}

  const allPlayersScored = players.length > 0 &&
    players.every((player) =>
      Object.prototype.hasOwnProperty.call(
        currentScores,
        player.id
      )
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
            disabled={
              !playerName.trim() || roomCodeInput.length !== 4
            }
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
                        <small>
                          {player.isHost ? 'Host' : 'Player'}
                        </small>
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

      {page === 'game' && round && (
        <main className="room-card game-page" dir="rtl">
          <div className="room-top">
            <h2>وقت اسم فامیل!</h2>
            <p>جواب‌ها رو وارد کن؛ اولین استوپ همه جواب‌ها رو قفل می‌کنه.</p>
          </div>

          <div className="room-code-box letter-box">
            <span>حرف این دور</span>
            <strong className="game-letter">{round.letter}</strong>
            <span>کد اتاق: {roomCode}</span>
          </div>

          <div className="answer-list">
            {CATEGORIES.map((category) => (
              <div className="answer-row" key={category}>
                <label htmlFor={`answer-${category}`}>
                  {category}
                </label>

                <input
                  id={`answer-${category}`}
                  type="text"
                  value={answers[category] || ''}
                  onChange={(e) =>
                    handleAnswerChange(category, e.target.value)
                  }
                  placeholder={`یک ${category} با حرف ${round.letter}`}
                  maxLength={100}
                  disabled={round.locked}
                />
              </div>
            ))}
          </div>

          <div className="players-heading">
            <h3>بازیکن‌ها</h3>
            <span>{players.length} نفر</span>
          </div>

          <div className="players-grid">
            {players.map((player) => (
              <div className="player-slot" key={player.id}>
                <div className="player-avatar">
                  {player.name.charAt(0).toUpperCase()}
                </div>
                <div className="player-info">
                  <strong>{player.name}</strong>
                  <small>
                    {round.stoppedBy === player.id
                      ? 'استوپ زده'
                      : round.locked
                        ? 'پاسخ‌ها قفل شدند'
                        : 'در حال پاسخ‌گویی'}
                  </small>
                </div>
              </div>
            ))}
          </div>

          {error && (
            <p className="error-message" role="alert">{error}</p>
          )}

          <button
            className="start-button stop-button"
            onClick={stopGame}
            disabled={round.locked}
          >
            {round.locked ? 'پاسخ‌ها قفل شدند' : '🛑 استوپ!'}
          </button>

          <p className="room-note">
            {round.locked
              ? 'همه پاسخ‌ها قفل شده‌اند؛ در حال ورود به امتیازدهی.'
              : 'با زدن استوپ، پاسخ همه بازیکن‌ها قفل می‌شود.'}
          </p>
        </main>
      )}

      {page === 'scoring' && round && (
        <main className="room-card scoring-page" dir="rtl">
          <div className="room-top">
            <h2>امتیازدهی</h2>
            <p>
              {isHost
                ? 'برای هر پاسخ، امتیاز مناسب رو انتخاب کن.'
                : 'میزبان در حال امتیاز دادن به پاسخ‌هاست.'}
            </p>
          </div>

          <div className="room-code-box letter-box">
            <span>حرف این دور</span>
            <strong className="game-letter">{round.letter}</strong>
            <span>
              دسته {round.categoryIndex + 1} از {CATEGORIES.length}
            </span>
          </div>

          <h3 className="scoring-category">
            دسته فعلی: {currentCategory}
          </h3>

          <div className="score-player-list">
            {players.map((player) => {
              const answer =
                round.answers?.[player.id]?.[currentCategory] || ''

              const hasScore = Object.prototype.hasOwnProperty.call(
                currentScores,
                player.id
              )

              const selectedScore = currentScores[player.id]

              return (
                <section className="score-player-card" key={player.id}>
                  <div className="score-player-heading">
                    <strong>{player.name}</strong>
                    {player.id === round.stoppedBy && (
                      <span className="host-badge">STOP</span>
                    )}
                  </div>

                  <div className="score-answer">
                    {answer || 'بدون پاسخ'}
                  </div>

                  <div className="score-buttons">
                    {SCORE_OPTIONS.map((score) => (
                      <button
                        key={score}
                        type="button"
                        className={`score-button ${hasScore && selectedScore === score
                            ? 'selected'
                            : ''
                          }`}
                        onClick={() =>
                          isHost && giveScore(player.id, score)
                        }
                        disabled={!isHost}
                      >
                        {score}
                      </button>
                    ))}
                  </div>

                  {hasScore && (
                    <p className="room-note">
                      امتیاز انتخاب‌شده: {selectedScore}
                    </p>
                  )}
                </section>
              )
            })}
          </div>

          {error && (
            <p className="error-message" role="alert">{error}</p>
          )}

          {isHost && (
            <button
              className="start-button"
              onClick={nextCategory}
              disabled={!allPlayersScored}
            >
              {round.categoryIndex === CATEGORIES.length - 1
                ? 'مشاهده نتیجه نهایی'
                : 'دسته بعدی'}
              <span> ←</span>
            </button>
          )}

          {!isHost && (
            <p className="room-note">
              بعد از امتیازدهی همه بازیکن‌ها، میزبان به دسته بعدی می‌رود.
            </p>
          )}
        </main>
      )}

      {page === 'results' && roomData && (
        <main className="room-card results-page" dir="rtl">
          <div className="game-icon">🏆</div>
          <h2>نتیجه نهایی</h2>
          <p className="description">
            امتیازهای این دور
          </p>

          <div className="final-score-list">
            {[...players]
              .sort(
                (a, b) =>
                  (roomData.totalScores?.[b.id] || 0) -
                  (roomData.totalScores?.[a.id] || 0)
              )
              .map((player, index) => (
                <div className="final-score-row" key={player.id}>
                  <span className="final-rank">
                    {index === 0 ? '🏆' : index + 1}
                  </span>
                  <strong>{player.name}</strong>
                  <span className="final-points">
                    {roomData.totalScores?.[player.id] || 0} امتیاز
                  </span>
                </div>
              ))}
          </div>

          <p className="room-note">
            کد اتاق: {roomCode}
          </p>

          <button className="back-button" onClick={backToHome}>
            بازگشت به صفحه اصلی
          </button>
        </main>
      )}

      <footer>Made for friends, made for fun.</footer>
    </div>
  )
}

export default App
