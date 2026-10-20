
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

const LETTERS = [
  'ا', 'ب', 'پ', 'ت', 'ج', 'چ', 'ح', 'خ',
  'د', 'ر', 'ز', 'س', 'ش', 'ع', 'غ', 'ف',
  'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی',
]

const SCORE_OPTIONS = [0, 5, 10, 15, 20]

const DEFAULT_SETTINGS = {
  totalRounds: 3,
  categories: [...CATEGORIES],
  letters: [...LETTERS],
}

function emptyAnswers(categories = CATEGORIES) {
  return Object.fromEntries(categories.map((category) => [category, '']))
}

function normalizeSettings(settings) {
  return {
    totalRounds: settings?.totalRounds ?? DEFAULT_SETTINGS.totalRounds,
    categories: [...(settings?.categories ?? DEFAULT_SETTINGS.categories)],
    letters: [...(settings?.letters ?? DEFAULT_SETTINGS.letters)],
  }
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
  const [settingsDraft, setSettingsDraft] = useState(
    () => normalizeSettings(DEFAULT_SETTINGS)
  )
  const [countdownNow, setCountdownNow] = useState(Date.now())

  const wsRef = useRef(null)
  const pendingMessagesRef = useRef([])

  function connectAndSend(message) {
    const existingSocket = wsRef.current

    if (existingSocket?.readyState === WebSocket.OPEN) {
      existingSocket.send(JSON.stringify(message))
      return
    }

    pendingMessagesRef.current.push(message)

    if (existingSocket?.readyState === WebSocket.CONNECTING) return

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
          const room = message.room

          setRoomCode(room.code)
          setPlayers(room.players)
          setPlayerId(message.playerId)
          setRoomData(room)
          setSettingsDraft(normalizeSettings(room.settings))
          setAnswers(emptyAnswers(room.settings?.categories || CATEGORIES))
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
          } else if (room.status === 'countdown') {
            setPage('countdown')
          } else if (room.status === 'answering') {
            setPage('game')
          } else if (room.status === 'scoring') {
            setPage('scoring')
          } else if (room.status === 'round_results') {
            setPage('roundResults')
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

  useEffect(() => {
    if (page !== 'countdown') return

    setCountdownNow(Date.now())

    const timer = setInterval(() => {
      setCountdownNow(Date.now())
    }, 100)

    return () => clearInterval(timer)
  }, [page, roomData?.countdownStartAt, roomData?.countdownEndsAt])

  useEffect(() => {
    const round = roomData?.round

    if (round && playerId) {
      setAnswers(
        round.answers?.[playerId] ||
        emptyAnswers(round.categories || CATEGORIES)
      )
    }
  }, [
    roomData?.round?.letter,
    roomData?.round?.roundNumber,
    playerId,
  ])

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
    connectAndSend({ type: 'kick_player', playerId: id })
  }

  function toggleCategory(category) {
    setSettingsDraft((previous) => {
      const selected = previous.categories.includes(category)

      return {
        ...previous,
        categories: selected
          ? previous.categories.filter((item) => item !== category)
          : CATEGORIES.filter(
              (item) =>
                previous.categories.includes(item) || item === category
            ),
      }
    })

    setError('')
  }

  function toggleLetter(letter) {
    setSettingsDraft((previous) => {
      const selected = previous.letters.includes(letter)

      return {
        ...previous,
        letters: selected
          ? previous.letters.filter((item) => item !== letter)
          : LETTERS.filter(
              (item) =>
                previous.letters.includes(item) || item === letter
            ),
      }
    })

    setError('')
  }

  function changeTotalRounds(value) {
    setSettingsDraft((previous) => ({
      ...previous,
      totalRounds: Number(value),
    }))
    setError('')
  }

  const savedSettings = normalizeSettings(roomData?.settings)
  const isHost = players.some(
    (player) => player.id === playerId && player.isHost
  )

  const settingsAreSaved =
    JSON.stringify(settingsDraft) === JSON.stringify(savedSettings)

  function saveSettings() {
    if (!isHost) {
      setError('فقط میزبان می‌تواند تنظیمات را تغییر دهد.')
      return
    }

    if (!settingsDraft.categories.length) {
      setError('حداقل یک دسته را انتخاب کن.')
      return
    }

    if (!settingsDraft.letters.length) {
      setError('حداقل یک حرف را انتخاب کن.')
      return
    }

    setError('')
    connectAndSend({
      type: 'save_settings',
      settings: settingsDraft,
    })
  }

  function startGame() {
    if (!settingsAreSaved) {
      setError('ابتدا تنظیمات را ذخیره کن.')
      return
    }

    setError('')
    connectAndSend({ type: 'start_game' })
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
      wsRef.current.send(JSON.stringify({ type: 'leave_room' }))
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
    const updatedAnswers = { ...answers, [category]: value }
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
    connectAndSend({ type: 'next_category' })
  }

  function nextRound() {
    setError('')
    connectAndSend({ type: 'next_round' })
  }

  const round = roomData?.round
  const currentCategory = round?.categories?.[round.categoryIndex]
  const currentScores = round?.scores?.[round.categoryIndex] || {}
  const roomSettings = normalizeSettings(roomData?.settings)

  const allPlayersScored =
    players.length > 0 &&
    players.every((player) =>
      Object.prototype.hasOwnProperty.call(currentScores, player.id)
    )

  let countdownNumber = 3

  if (roomData?.countdownStartAt && roomData?.countdownEndsAt) {
    if (countdownNow >= roomData.countdownStartAt) {
      countdownNumber = Math.max(
        1,
        Math.min(
          3,
          Math.ceil((roomData.countdownEndsAt - countdownNow) / 1000)
        )
      )
    }
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
            <label htmlFor="playerName">اسم خودت رو وارد کن</label>
            <input
              id="playerName"
              type="text"
              placeholder="مثلاً علی..."
              value={playerName}
              onChange={handleNameChange}
              maxLength={20}
              autoComplete="nickname"
            />

            <label htmlFor="roomCodeInput">کد اتاق دوستانت (۴ رقم)</label>
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

            {error && <p className="error-message" role="alert">{error}</p>}
            {connectionStatus && (
              <p className="room-note">{connectionStatus}</p>
            )}
          </div>

          <div className="game-icon">🎮</div>
          <h2>Let's Play!</h2>
          <p className="description">Create a room or join your friends</p>

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

          <section className="game-settings" dir="rtl">
            <h3>⚙️ تنظیمات بازی</h3>

            <div className="settings-section">
              <label htmlFor="totalRounds">تعداد دورهای بازی</label>

              {isHost ? (
                <select
                  id="totalRounds"
                  value={settingsDraft.totalRounds}
                  onChange={(e) => changeTotalRounds(e.target.value)}
                >
                  {Array.from({ length: 10 }, (_, index) => index + 1).map(
                    (number) => (
                      <option key={number} value={number}>
                        {number} دور
                      </option>
                    )
                  )}
                </select>
              ) : (
                <p>{roomSettings.totalRounds} دور</p>
              )}
            </div>

            <div className="settings-section">
              <h4>دسته‌های بازی</h4>
              <p className="room-note">
                {isHost
                  ? 'دسته‌هایی را که می‌خواهی در بازی باشند انتخاب کن.'
                  : 'دسته‌های انتخاب‌شده برای این بازی:'}
              </p>

              <div className="settings-grid">
                {CATEGORIES.map((category) => {
                  const checked = isHost
                    ? settingsDraft.categories.includes(category)
                    : roomSettings.categories.includes(category)

                  return (
                    <label className="setting-option" key={category}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!isHost}
                        onChange={() => toggleCategory(category)}
                      />
                      <span>{category}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="settings-section">
              <h4>حروف مجاز</h4>
              <p className="room-note">
                {isHost
                  ? 'حرف‌های مجاز را انتخاب کن. در هر دور یکی از این حروف انتخاب می‌شود.'
                  : 'حروفی که میزبان برای بازی انتخاب کرده است:'}
              </p>

              <div className="settings-grid letters-grid">
                {LETTERS.map((letter) => {
                  const checked = isHost
                    ? settingsDraft.letters.includes(letter)
                    : roomSettings.letters.includes(letter)

                  return (
                    <label
                      className="setting-option letter-option"
                      key={letter}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!isHost}
                        onChange={() => toggleLetter(letter)}
                      />
                      <span>{letter}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {isHost && (
              <div className="settings-actions">
                <p className="room-note">
                  {settingsAreSaved
                    ? 'تنظیمات ذخیره شده‌اند.'
                    : 'تغییرات ذخیره نشده‌اند.'}
                </p>
                <button
                  className="start-button"
                  onClick={saveSettings}
                  disabled={settingsAreSaved}
                >
                  ذخیره تنظیمات
                </button>
              </div>
            )}

            {!isHost && (
              <p className="room-note">
                تنظیمات این اتاق توسط میزبان کنترل می‌شود.
              </p>
            )}
          </section>

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

          <p className="room-note">Share the room code with your friends.</p>
          {error && <p className="error-message" role="alert">{error}</p>}

          {isHost && (
            <button
              className="start-button"
              onClick={startGame}
              disabled={!settingsAreSaved}
            >
              Start Game <span>→</span>
            </button>
          )}

          <button className="back-button" onClick={backToHome}>
            ← Back to Home
          </button>
        </main>
      )}

      {page === 'countdown' && round && (
        <main className="room-card countdown-page" dir="rtl">
          <div className="room-top">
            <h2>آماده‌ای؟</h2>
            <p>
              دور {round.roundNumber} از {round.totalRounds}
            </p>
          </div>

          <div className="countdown-number" aria-live="polite">
            {countdownNumber}
          </div>

          <p className="description">بازی تا لحظاتی دیگر شروع می‌شود...</p>

          <div className="room-code-box letter-box">
            <span>حرف این دور</span>
            <strong className="game-letter">{round.letter}</strong>
          </div>
        </main>
      )}

      {page === 'game' && round && (
        <main className="room-card game-page" dir="rtl">
          <div className="room-top">
            <h2>وقت اسم فامیل!</h2>
            <p>
              دور {round.roundNumber} از {round.totalRounds}
              {' — '}
              جواب‌ها رو وارد کن؛ اولین استوپ همه جواب‌ها رو قفل می‌کنه.
            </p>
          </div>

          <div className="room-code-box letter-box">
            <span>حرف این دور</span>
            <strong className="game-letter">{round.letter}</strong>
            <span>کد اتاق: {roomCode}</span>
          </div>

          <div className="answer-list">
            {round.categories.map((category) => (
              <div className="answer-row" key={category}>
                <label htmlFor={`answer-${category}`}>{category}</label>
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

          {error && <p className="error-message" role="alert">{error}</p>}

          <button
            className="start-button stop-button"
            onClick={stopGame}
            disabled={round.locked}
          >
            {round.locked ? 'پاسخ‌ها قفل شدند' : '🛑 استوپ!'}
          </button>

          <p className="room-note">
            {round.locked
              ? 'همه پاسخ‌ها قفل شده‌اند.'
              : 'با زدن استوپ، پاسخ همه بازیکن‌ها قفل می‌شود.'}
          </p>

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
              دور {round.roundNumber} از {round.totalRounds}
            </span>
            <span>
              دسته {round.categoryIndex + 1} از {round.categories.length}
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
                        className={`score-button ${
                          hasScore && selectedScore === score
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

          {error && <p className="error-message" role="alert">{error}</p>}

          {isHost && (
            <button
              className="start-button"
              onClick={nextCategory}
              disabled={!allPlayersScored}
            >
              {round.categoryIndex === round.categories.length - 1
                ? 'مشاهده امتیازهای این دور'
                : 'دسته بعدی'}
              <span> ←</span>
            </button>
          )}

          {!isHost && (
            <p className="room-note">
              بعد از امتیازدهی همه بازیکن‌ها، میزبان ادامه می‌دهد.
            </p>
          )}
        </main>
      )}

      {page === 'roundResults' && round && roomData && (
        <main className="room-card results-page" dir="rtl">
          <div className="game-icon">🏅</div>
          <h2>نتیجه دور {round.roundNumber}</h2>
          <p className="description">
            امتیاز این دور و مجموع امتیازهای بازی
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

                  <div className="round-score-details">
                    <span>
                      این دور: {round.roundScores?.[player.id] || 0}
                    </span>
                    <span className="final-points">
                      مجموع: {roomData.totalScores?.[player.id] || 0}
                    </span>
                  </div>
                </div>
              ))}
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}

          {isHost ? (
            <button className="start-button" onClick={nextRound}>
              {round.roundNumber >= round.totalRounds
                ? 'نمایش نتیجه نهایی'
                : 'تأیید و شروع دور بعد'}
              <span> →</span>
            </button>
          ) : (
            <p className="room-note">
              منتظر تأیید میزبان برای ادامه بازی بمان.
            </p>
          )}
        </main>
      )}

      {page === 'results' && roomData && (
        <main className="room-card results-page" dir="rtl">
          <div className="game-icon">🏆</div>
          <h2>نتیجه نهایی</h2>
          <p className="description">
            امتیاز کل پس از {roomData.settings?.totalRounds || 3} دور
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

          <p className="room-note">کد اتاق: {roomCode}</p>
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
