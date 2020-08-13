require('dotenv').config()

const redis = require("redis")
const WebSocket = require('ws')
const axios = require('axios').default

const logger = console

if (!process.env.DISCORD_TOKEN) {
  logger.error('Missing DISCORD_TOKEN environment variable')
  process.exit(0)
}

async function initialize (token, redisClient) {
  const httpClient = axios.create({
    baseURL: 'https://discord.com/api/v6',
    headers: {
      'Authorization': `Bot ${token}`
    }
  })

  logger.debug('Fetching gateway address')

  const { data: { url } } = await httpClient.get('/gateway/bot')

  logger.debug(`Got gateway address: ${url}`)

  var lastSequence = null
  var lastHeartbeat, lastAck

  const ws = new WebSocket(`${url}/?v=6&encoding=json`)

  function initializeHeartbeats (interval) {
    logger.debug(`Initializing heartbeats. Sending one every ${interval}ms`)
    sendHeartbeat()
    setInterval(() => {
      sendHeartbeat()
    }, interval)
  }

  function sendPacket (packet) {
    logger.info('Outbound Packet', packet)
    ws.send(JSON.stringify(packet))
  }

  function sendHeartbeat () {
    logger.info('Sending heartbeat')
    sendPacket({
      op: 1,
      d: lastSequence || null
    })
  }

  function sendIdentify () {
    logger.debug('Sending identify')
    sendPacket({
      op: 2,
      d: {
        token,
        properties: {
          $os: "linux",
          $browser: "botproject",
          $device: "botproject"
        }
      }
    })
  }

  function handlePacket (packet) {
    lastSequence = packet.s
    switch (packet.op) {
      case 0:
        handleDispatch(packet)
        break
      case 1:
        sendHeartbeat()
        break
      case 9:
        handleInvalidSession(packet)
        break
      case 10:
        initializeHeartbeats(packet.d.heartbeat_interval)
        sendIdentify()
        break
    }
  }

  function handlePresence (guild, presence) {
    logger.debug(`Caching presence for ${presence.user.id} in ${guild}`)
    redisClient.set(`presence:${guild}:${presence.user.id}`, presence.status)
  }

  function handleInvalidSession (packet) {
    if (packet.d) {
      // resume logic
    } else {
      logger.error('Invalid session')
      process.exit(1)
    }
  }

  function handleDispatch (packet) {
    switch (packet.t) {
      case 'PRESENCE_UPDATE':
        handlePresence(packet.d.guild_id, packet.d)
        break
      case 'GUILD_CREATE':
        packet.d.presences.forEach(presence => {
          handlePresence(packet.d.id, presence)
        })
        break
    }
  }

  ws.on('open', () => {
    logger.log('Connection open!')
  })

  ws.on('message', data => {
    const packet = JSON.parse(data)
    lastSequence = data.s
    logger.debug('Inbound Packet', packet)
    handlePacket(packet)
  })
}

logger.info('Connecting to Redis...')
const redisClient = redis.createClient()

redisClient.on('ready', () => {
  logger.info('Redis client ready. Starting gateway connection...')
  initialize(process.env.DISCORD_TOKEN, redisClient)
})
