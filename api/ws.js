
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
const ROOM_TTL = 15 * 60
const MAX_PLAYERS = 15

app.get('/api/ws', (req, res) => {
  res.status(200).send('Esm Famil WebSocket server is ready.')
})

server.on('upgrade', (request, socket, head) => {
  const path = request.url?.split('?')[0]

  if (path !== '/api/ws') {
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
  return redis.get(roomKey(code))
}

async function saveRoom(room) {
  room.updatedAt = Date.now()

  await redis.set(
    roomKey(room.code),
    JSON.stringify(room),
    { ex: ROOM_TTL }
  )
}

function sendRoomState(ws, room) {
  send(ws, {
    type: 'room_state',
    room,
  })

  ws.lastSentVersion = room.updatedAt
}

async function createRoom(ws, name) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = String(
      Math.floor(1000 + Math.random() * 9000)
    )

    const playerId = randomUUID()

    const room = {
      code,
      hostId: playerId,
      status: 'waiting',
      players: [
        {
          id: playerId,
          name,
          isHost: true,
        },
      ],
      updatedAt: Date.now(),
    }

    const result = await redis.set(
      roomKey(code),
      JSON.stringify(room),
      {
        ex: ROOM_TTL,
        nx: true,
      }
    )

    if (result === 'OK') {
      ws.roomCode = code
      ws.playerId = playerId

      send(ws, {
        type: 'room_created',
        room,
        playerId,
      })

      ws.lastSentVersion = room.updatedAt
      return
    }
  }

  send(ws, {
    type: 'error',
    message: 'ساخت اتاق ناموفق بود. دوباره تلاش کنید.',
  })
}

async function joinRoom(ws, code, name) {
  if (!/^\d{4}$/.test(code)) {
    send(ws, {
      type: 'error',
      message: 'کد اتاق باید دقیقاً ۴ رقم باشد.',
    })
    return
  }

  const room = await getRoom(code)

  if (!room) {
    send(ws, {
      type: 'error',
      message: 'اتاقی با این کد پیدا نشد.',
    })
    return
  }

  if (room.status !== 'waiting') {
    send(ws, {
      type: 'error',
      message: 'بازی این اتاق شروع شده است.',
    })
    return
  }

  if (room.players.length >= MAX_PLAYERS) {
    send(ws, {
      type: 'error',
      message: 'ظرفیت اتاق تکمیل است.',
    })
    return
  }

  const playerId = randomUUID()

  room.players.push({
    id: playerId,
    name,
    isHost: false,
  })

  await saveRoom(room)

  ws.roomCode = code
  ws.playerId = playerId

  send(ws, {
    type: 'joined_room',
    room,
    playerId,
  })

  ws.lastSentVersion = room.updatedAt
}

async function kickPlayer(ws, playerId) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    send(ws, {
      type: 'error',
      message: 'فقط میزبان می‌تواند بازیکن را حذف کند.',
    })
    return
  }

  if (playerId === room.hostId) return

  room.players = room.players.filter(
    (player) => player.id !== playerId
  )

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function startGame(ws) {
  const room = await getRoom(ws.roomCode)

  if (!room || room.hostId !== ws.playerId) {
    send(ws, {
      type: 'error',
      message: 'فقط میزبان می‌تواند بازی را شروع کند.',
    })
    return
  }

  room.status = 'playing'

  await saveRoom(room)
  sendRoomState(ws, room)
}

async function leaveRoom(ws) {
  if (!ws.roomCode || !ws.playerId) return

  const room = await getRoom(ws.roomCode)

  if (!room) return

  room.players = room.players.filter(
    (player) => player.id !== ws.playerId
  )

  if (room.players.length === 0) {
    await redis.del(roomKey(room.code))
    return
  }

  if (room.hostId === ws.playerId) {
    room.hostId = room.players[0].id
    room.players[0].isHost = true
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
          send(ws, {
            type: 'error',
            message: 'نام بازیکن باید بین ۱ تا ۲۰ حرف باشد.',
          })
          return
        }

        await createRoom(ws, name)
      }

      if (message.type === 'join_room') {
        const name = String(message.name || '').trim()
        const code = String(message.code || '').trim()

        if (!name || name.length > 20) {
          send(ws, {
            type: 'error',
            message: 'نام بازیکن باید بین ۱ تا ۲۰ حرف باشد.',
          })
          return
        }

        await joinRoom(ws, code, name)
      }

      if (message.type === 'kick_player') {
        await kickPlayer(ws, String(message.playerId || ''))
      }

      if (message.type === 'start_game') {
        await startGame(ws)
      }

      if (message.type === 'leave_room') {
        await leaveRoom(ws)
        ws.roomCode = null
        ws.playerId = null
      }
    } catch (error) {
      console.error('WebSocket message error:', error)

      send(ws, {
        type: 'error',
        message: 'خطایی در سرور رخ داد.',
      })
    }
  })

  // Sync room changes made by other server instances.
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

      const playerStillExists = room.players.some(
        (player) => player.id === ws.playerId
      )

      if (!playerStillExists) {
        send(ws, {
          type: 'kicked',
          message: 'شما از اتاق خارج شده‌اید.',
        })

        ws.roomCode = null
        ws.playerId = null
        return
      }

      if (room.updatedAt !== ws.lastSentVersion) {
        sendRoomState(ws, room)
      }
    } catch (error) {
      console.error('Room sync error:', error)
    }
  }, 1000)

  ws.on('close', () => {
    clearInterval(ws.syncInterval)

    leaveRoom(ws).catch((error) => {
      console.error('Leave room error:', error)
    })
  })
})

export default server
