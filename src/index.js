require('dotenv').config()

const redis = require("redis")
const WebSocket = require('ws')
const axios = require('axios').default

require('array-flat-polyfill')

const logger = console

if (!process.env.DISCORD_TOKEN) {
  logger.error('Missing DISCORD_TOKEN environment variable')
  process.exit(0)
}

function initialize (token) {
  logger.info('Connecting to Redis...')
  const redisClient = redis.createClient()

  redisClient.on('ready', async () => {
    logger.info('Redis client ready. Starting gateway connection...')

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
        // logger.debug('Inbound Packet', packet)
        handlePacket(packet)
      })
    }
  
    function reconnect () {
      clearInterval(heartbeatIntervalId)
      ws.close()
      connect()
    }
  
    function handlePresence (id, presence) {
      // logger.debug(`Caching presence for ${presence.user.id} in ${id}`)
      redisClient.hset(`presences:${id}`, presence.user.id, JSON.stringify(presence))
    }

    /**
     * Caches multiple guild members from an array
     * @param {String} id 
     * @param {Array<Object>} members 
     */
    function handlePresences (id, presences) {
      logger.debug(`Caching ${presences.length} presences from ${id}`)
      redisClient.hmset(`presences:${id}`, presences.map(presence => [ presence.user.id, JSON.stringify(presence) ]).flat())
    }
  
    /**
     * Caches a guild member
     * @param {String} id
     * @param {Object} member 
     */
    function handleGuildMember (id, member) {
      logger.debug(`Caching guild member ${member.user.id} in ${id}`)
      redisClient.hset(`members:${id}`, member.user.id, JSON.stringify(member))
    }

    /**
     * Caches multiple guild members from an array
     * @param {String} id 
     * @param {Array<Object>} members 
     */
    function handleGuildMembers (id, members) {
      logger.debug(`Caching ${members.length} members from ${id}`)
      redisClient.hmset(`members:${id}`, members.map(member => [ member.user.id, JSON.stringify(member) ]).flat())
    }
  
    function handleGuild (guild) {
      handlePresences(guild.id, guild.presences)
      handleGuildMembers(guild.id, guild.members)
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
  })
}

initialize(process.env.DISCORD_TOKEN)