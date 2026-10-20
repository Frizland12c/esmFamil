
import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { Redis } from '@upstash/redis'
import { randomUUID } from 'node:crypto'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const redis = Redis.fromEnv()

const PREFIX = 'esmFamil:'
const ROOM_TTL = 60 * 60
const MAX_PLAYERS = 15
const COUNTDOWN_LEAD_MS = 1500
const COUNTDOWN_DURATION_MS = 3000

const CATEGORIES = [
  'اسم', 'فامیل', 'شهر', 'کشور', 'غذا',
  'رنگ', 'حیوان', 'ماشین', 'فیلم یا سریال', 'اشیاء',
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

app.get('/api/ws', (req, res) => {
  res.status(200).send('Esm Famil WebSocket server is ready.')
})

server.on('upgrade', (request, socket, head) => {
  if (request.url?.split('?')[0] !== '/api/ws') {
    socket.destroy()
    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

function roomKey(code) {
  return `${PREFIX}room:${code}`
}

async function getRoom(code) {
  if (!code) return null

  const data = await redis.get(roomKey(code))
  if (!data) return null

  return typeof data === 'string' ? JSON.parse(data) : data
}

async function saveRoom(room) {
  room.updatedAt = Math.max(Date.now(), (room.updatedAt || 0) + 1)

  await redis.set(
    roomKey(room.code),
    JSON.stringify(room),
    { ex: ROOM_TTL }
  )
}

function sendRoomState(ws, room) {
  send(ws, { type: 'room_state', room })
  ws.lastSentVersion = room.updatedAt
}

function sendError(ws, message) {
  send(ws, { type: 'error', message })
}

function getRoomSettings(room) {
  const saved = room.settings || DEFAULT_SETTINGS

  return {
    totalRounds: saved.totalRounds ?? DEFAULT_SETTINGS.totalRounds,
    categories: [...(saved.categories || DEFAULT_SETTINGS.categories)],
    letters: [...(saved.letters || DEFAULT_SETTINGS.letters)],
  }
}

function cleanAnswers(rawAnswers, categories = CATEGORIES) {
  const answers = {}

  for (const category of categories) {
    const value = rawAnswers?.[category]
    answers[category] =
      typeof value === 'string' ? value.trim().slice(0, 100) : ''
  }

  return answers
}

function isPlayer(room, playerId) {
  return room.players.some((player) => player.id === playerId)
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)]
}

function prepareRound(room, roundNumber) {
  const settings = getRoomSettings(room)
  const answers = {}

  for (const player of room.players) {
    answers[player.id] = cleanAnswers({}, settings.categories)
  }

  const now = Date.now()

  room.round = {
    roundNumber,
    totalRounds: settings.totalRounds,
    letter: randomItem(settings.letters),
    categoryIndex: 0,
    categories: [...settings.categories],
    answers,
    stoppedBy: null,
    locked: false,
    scores: {},
    roundScores: {},
  }

  // Everyone uses the same server timestamps.
  room.status = 'countdown'
  room.countdownStartAt = now + COUNTDOWN_LEAD_MS
  room.countdownEndsAt =
    room.countdownStartAt + COUNTDOWN_DURATION_MS
}

async function createRoom(ws, name) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    const playerId = randomUUID()

    const room = {
      code,
      hostId: playerId,
      status: 'waiting',
      settings: {
        totalRounds: DEFAULT_SETTINGS.totalRounds,
        categories: [...DEFAULT_SETTINGS.categories],
        letters: [...DEFAULT_SETTINGS.letters],
      },
      players: [{ id: playerId, name, isHost: true }],
      updatedAt: Date.now(),
    }

    const result = await redis.set(
      roomKey(code),
      JSON.stringify(room),
      { ex: ROOM_TTL, nx: true }
    )

    if (result === 'OK') {
      ws.roomCode = code
      ws.playerId = playerId
      send(ws, { type: 'room_created', room, playerId })
      ws.lastSentVersion = room.updatedAt
      return
    }
  }

  sendError(ws, 'ساخت اتاق ناموفق بود. دوباره تلاش کنید.')
}

async function joinRoom(ws, code, name) {
  if (!/^\d{4}$/.test(code)) {
    sendError(ws, 'کد اتاق باید دقیقاً ۴ رقم باشد.')
    return
  }

  const room = await getRoom(code)

  if (!room) {
    sendError(ws, 'اتاقی با این کد پیدا نشد.')
    return
  }

  if (room.status !== 'waiting') {
    sendError(ws, 'بازی این اتاق شروع شده است.')
    return
  }

  if (room.players.length >= MAX_PLAYERS) {
    sendError(ws, 'ظرفیت اتاق تکمیل است.')
    return
  }

  const playerId = randomUUID()
  room.players.push({ id: playerId, name, isHost: false })

  await saveRoom(room)

  ws.roomCode = code
  ws.playerId = playerId

  send(ws, { type: 'joined_room', room, playerId })
  ws.lastSentVersion = room.updatedAt
}

async function kickPlayer(ws, playerId) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    sendError(ws, 'فقط میزبان می‌تواند بازیکن را حذف کند.')
    return
  }

  if (room.status !== 'waiting') {
    sendError(ws, 'بعد از شروع بازی نمی‌توان بازیکن را حذف کرد.')
    return
  }

  if (playerId === room.hostId) return

  room.players = room.players.filter((player) => player.id !== playerId)

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function saveSettings(ws, rawSettings) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    sendError(ws, 'فقط میزبان می‌تواند تنظیمات را تغییر دهد.')
    return
  }

  if (room.status !== 'waiting') {
    sendError(ws, 'تنظیمات فقط قبل از شروع بازی قابل تغییر است.')
    return
  }

  const totalRounds = rawSettings?.totalRounds
  const categories = Array.isArray(rawSettings?.categories)
    ? [...new Set(rawSettings.categories)]
    : []
  const letters = Array.isArray(rawSettings?.letters)
    ? [...new Set(rawSettings.letters)]
    : []

  const validRounds =
    Number.isInteger(totalRounds) && totalRounds >= 1 && totalRounds <= 10
  const validCategories =
    categories.length > 0 &&
    categories.every((category) => CATEGORIES.includes(category))
  const validLetters =
    letters.length > 0 &&
    letters.every((letter) => LETTERS.includes(letter))

  if (!validRounds || !validCategories || !validLetters) {
    sendError(ws, 'تنظیمات انتخاب‌شده معتبر نیست.')
    return
  }

  room.settings = { totalRounds, categories, letters }

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function startGame(ws) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    sendError(ws, 'فقط میزبان می‌تواند بازی را شروع کند.')
    return
  }

  if (room.status !== 'waiting') {
    sendError(ws, 'بازی قبلاً شروع شده است.')
    return
  }

  if (room.players.length < 2) {
    sendError(ws, 'برای شروع بازی حداقل دو بازیکن لازم است.')
    return
  }

  const settings = getRoomSettings(room)

  const validSettings =
    Number.isInteger(settings.totalRounds) &&
    settings.totalRounds >= 1 &&
    settings.totalRounds <= 10 &&
    settings.categories.length > 0 &&
    settings.letters.length > 0 &&
    settings.categories.every((category) => CATEGORIES.includes(category)) &&
    settings.letters.every((letter) => LETTERS.includes(letter))

  if (!validSettings) {
    sendError(ws, 'تنظیمات بازی معتبر نیست.')
    return
  }

  room.settings = settings
  room.totalScores = Object.fromEntries(
    room.players.map((player) => [player.id, 0])
  )

  prepareRound(room, 1)

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function saveAnswers(ws, rawAnswers) {
  const room = await getRoom(ws.roomCode)

  if (!room || !isPlayer(room, ws.playerId)) {
    sendError(ws, 'اتاق یا بازیکن پیدا نشد.')
    return
  }

  if (room.status !== 'answering' || room.round?.locked) {
    sendError(ws, 'زمان پاسخ‌گویی تمام شده و جواب‌ها قفل شده‌اند.')
    return
  }

  room.round.answers[ws.playerId] = cleanAnswers(
    rawAnswers,
    room.round.categories
  )

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function stopRound(ws, rawAnswers) {
  const room = await getRoom(ws.roomCode)

  if (!room || !isPlayer(room, ws.playerId)) {
    sendError(ws, 'اتاق یا بازیکن پیدا نشد.')
    return
  }

  if (room.status !== 'answering' || room.round?.locked) return

  if (rawAnswers && typeof rawAnswers === 'object') {
    room.round.answers[ws.playerId] = cleanAnswers(
      rawAnswers,
      room.round.categories
    )
  }

  room.round.locked = true
  room.round.stoppedBy = ws.playerId
  room.status = 'scoring'

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function scoreCategory(ws, playerId, score) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    sendError(ws, 'فقط میزبان می‌تواند امتیاز بدهد.')
    return
  }

  if (room.status !== 'scoring' || !room.round?.locked) {
    sendError(ws, 'هنوز زمان امتیازدهی نیست.')
    return
  }

  if (!isPlayer(room, playerId)) {
    sendError(ws, 'این بازیکن در اتاق نیست.')
    return
  }

  if (!SCORE_OPTIONS.includes(score)) {
    sendError(ws, 'امتیاز انتخاب‌شده معتبر نیست.')
    return
  }

  const categoryIndex = room.round.categoryIndex

  if (!room.round.scores[categoryIndex]) {
    room.round.scores[categoryIndex] = {}
  }

  room.round.scores[categoryIndex][playerId] = score

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function nextCategory(ws) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    sendError(ws, 'فقط میزبان می‌تواند ادامه دهد.')
    return
  }

  if (room.status !== 'scoring' || !room.round?.locked) {
    sendError(ws, 'بازی در مرحله امتیازدهی نیست.')
    return
  }

  const categoryIndex = room.round.categoryIndex
  const categories = room.round.categories
  const categoryScores = room.round.scores[categoryIndex] || {}

  const everyoneScored = room.players.every((player) =>
    Object.prototype.hasOwnProperty.call(categoryScores, player.id)
  )

  if (!everyoneScored) {
    sendError(ws, 'ابتدا باید به همه بازیکنان امتیاز بدهی.')
    return
  }

  if (categoryIndex < categories.length - 1) {
    room.round.categoryIndex += 1
    await saveRoom(room)
    sendRoomState(ws, room)
    return
  }

  // Calculate and store this round's score exactly once.
  const roundScores = {}

  for (const player of room.players) {
    let scoreForRound = 0

    for (let index = 0; index < categories.length; index++) {
      scoreForRound += room.round.scores[index]?.[player.id] ?? 0
    }

    roundScores[player.id] = scoreForRound
    room.totalScores[player.id] =
      (room.totalScores[player.id] || 0) + scoreForRound
  }

  room.round.roundScores = roundScores
  room.status = 'round_results'

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function nextRound(ws) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    sendError(ws, 'فقط میزبان می‌تواند دور بعدی را شروع کند.')
    return
  }

  if (room.status !== 'round_results' || !room.round) {
    sendError(ws, 'ابتدا باید نتایج دور را بررسی کنید.')
    return
  }

  const settings = getRoomSettings(room)

  // Final round: move to the final ranking page.
  if (room.round.roundNumber >= settings.totalRounds) {
    room.status = 'finished'
    await saveRoom(room)
    sendRoomState(ws, room)
    return
  }

  prepareRound(room, room.round.roundNumber + 1)

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function leaveRoom(ws) {
  if (!ws.roomCode || !ws.playerId) return

  const room = await getRoom(ws.roomCode)
  if (!room) return

  room.players = room.players.filter((player) => player.id !== ws.playerId)

  if (room.players.length === 0) {
    await redis.del(roomKey(room.code))
    return
  }

  if (room.hostId === ws.playerId) {
    room.hostId = room.players[0].id
    room.players = room.players.map((player) => ({
      ...player,
      isHost: player.id === room.hostId,
    }))
  }

  await saveRoom(room)
}

wss.on('connection', (ws) => {
  ws.roomCode = null
  ws.playerId = null
  ws.lastSentVersion = null

  send(ws, { type: 'connected' })

  ws.on('message', async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString())

      if (message.type === 'create_room') {
        const name = String(message.name || '').trim()

        if (!name || name.length > 20) {
          sendError(ws, 'نام بازیکن باید بین ۱ تا ۲۰ حرف باشد.')
          return
        }

        await createRoom(ws, name)
      } else if (message.type === 'join_room') {
        const name = String(message.name || '').trim()
        const code = String(message.code || '').trim()

        if (!name || name.length > 20) {
          sendError(ws, 'نام بازیکن باید بین ۱ تا ۲۰ حرف باشد.')
          return
        }

        await joinRoom(ws, code, name)
      } else if (message.type === 'kick_player') {
        await kickPlayer(ws, String(message.playerId || ''))
      } else if (message.type === 'save_settings') {
        await saveSettings(ws, message.settings)
      } else if (message.type === 'start_game') {
        await startGame(ws)
      } else if (message.type === 'save_answers') {
        await saveAnswers(ws, message.answers)
      } else if (message.type === 'stop_round') {
        await stopRound(ws, message.answers)
      } else if (message.type === 'score_category') {
        await scoreCategory(
          ws,
          String(message.playerId || ''),
          Number(message.score)
        )
      } else if (message.type === 'next_category') {
        await nextCategory(ws)
      } else if (message.type === 'next_round') {
        await nextRound(ws)
      } else if (message.type === 'leave_room') {
        await leaveRoom(ws)
        ws.roomCode = null
        ws.playerId = null
      }
    } catch (error) {
      console.error('WebSocket message error:', error)
      sendError(ws, 'خطایی در سرور رخ داد.')
    }
  })

  ws.syncInterval = setInterval(async () => {
    try {
      if (!ws.roomCode || !ws.playerId) return

      const room = await getRoom(ws.roomCode)

      if (!room) {
        send(ws, {
          type: 'room_closed',
          message: 'اتاق دیگر وجود ندارد.',
        })
        ws.close()
        return
      }

      if (!isPlayer(room, ws.playerId)) {
        send(ws, {
          type: 'kicked',
          message: 'شما از اتاق خارج شده‌اید.',
        })
        ws.roomCode = null
        ws.playerId = null
        return
      }

      // The server, not an individual browser, ends the countdown.
      if (
        room.status === 'countdown' &&
        Date.now() >= room.countdownEndsAt
      ) {
        room.status = 'answering'
        delete room.countdownStartAt
        delete room.countdownEndsAt
        await saveRoom(room)
      }

      if (room.updatedAt !== ws.lastSentVersion) {
        sendRoomState(ws, room)
      }
    } catch (error) {
      console.error('Room sync error:', error)
    }
  }, 500)

  ws.on('close', () => {
    clearInterval(ws.syncInterval)
  })
})

export default server
