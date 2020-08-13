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

  var lastSequence, sessionId, lastHeartbeatTime, lastAckTime, ws, heartbeatIntervalId

  connect()

  function initializeHeartbeats (interval) {
    logger.debug(`Initializing heartbeats. Sending one every ${interval}ms`)
    sendHeartbeat()
    heartbeatIntervalId = setInterval(() => {
      sendHeartbeat()
    }, interval)
  }

  function sendPacket (packet) {
    logger.info('Outbound Packet', packet)
    ws.send(JSON.stringify(packet))
  }

  function sendHeartbeat () {
    if (lastHeartbeatTime > lastAckTime) return reconnect()
    logger.info('Sending heartbeat.')
    sendPacket({
      op: 1,
      d: lastSequence || null
    })
    lastHeartbeatTime = Date.now()
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
      case 7:
        reconnect()
        break
      case 9:
        handleInvalidSession(packet)
        break
      case 10:
        initializeHeartbeats(packet.d.heartbeat_interval)
        sendIdentify()
        break
      case 11:
        lastAckTime = Date.now()
    }
  }

  function connect () {
    ws = new WebSocket(`${url}/?v=6&encoding=json`)

    ws.on('open', () => {
      logger.log('Connection open!')

      if (sessionId && lastSequence) {
        logger.info('Sending resume packet')
        sendPacket({
          op: 6,
          d: {
            token,
            session_id: sessionId,
            seq: lastSequence
          }
        })
      }
    })
  
    ws.on('message', data => {
      const packet = JSON.parse(data)
      lastSequence = data.s
      logger.debug('Inbound Packet', packet)
      handlePacket(packet)
    })
  }

  function reconnect () {
    clearInterval(heartbeatIntervalId)
    ws.close()
    connect()
  }

  function handlePresence (id, presence) {
    logger.debug(`Caching presence for ${presence.user.id} in ${id}`)
    redisClient.hset(`guilds:${id}:presences`, presence.user.id, JSON.stringify(presence))
  }

  function handleGuildMember (id, member) {
    logger.debug(`Caching guild member ${member.user.id} in ${id}`)
    redisClient.hset(`guilds:${id}:members`, member.user.id, JSON.stringify(member))
  }

  function handleGuild (guild) {
    guild.presences.forEach(presence => {
      handlePresence(guild.id, presence)
    })
    guild.members.forEach(member => {
      handleGuildMember(guild.id, member)
    })
  }

  function handleInvalidSession (packet) {
    if (packet.d) {
      reconnect()
    } else {
      logger.error('Invalid session')
      process.exit(1)
    }
  }

  function handleDispatch (packet) {
    switch (packet.t) {
      case 'READY':
        sessionId = packet.d.session_id
        break
      case 'PRESENCE_UPDATE':
        handlePresence(packet.d.guild_id, packet.d)
        break
      case 'GUILD_CREATE':
        handleGuild(packet.d)
        break
    }
  }
}

logger.info('Connecting to Redis...')
const redisClient = redis.createClient()

redisClient.on('ready', () => {
  logger.info('Redis client ready. Starting gateway connection...')
  initialize(process.env.DISCORD_TOKEN, redisClient)
})
