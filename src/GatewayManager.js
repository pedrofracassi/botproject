const WebSocket = require('ws')
const axios = require('axios').default

const EventEmitter = require('events')

module.exports = class GatewayManager extends EventEmitter {
  constructor ({ token, logger }) {
    super()
    this.token = token

    this.logger = logger || console

    this.lastSequence = null
    this.sessionId = null
    this.lastHeartbeatTime = null
    this.lastAckTime = null
    this.websocket = null
    this.heartbeatIntervalId = null
  }

  async connect () {
    const httpClient = axios.create({
      baseURL: 'https://discord.com/api/v6',
      headers: {
        'Authorization': `Bot ${this.token}`
      }
    })

    const { data: { url } } = await httpClient.get('/gateway/bot')

    this.websocket = new WebSocket(`${url}/?v=6&encoding=json`)

    this.websocket.on('open', () => {
      if (this.sessionId && this.lastSequence) {
        this.sendPacket({
          op: 6,
          d: {
            token: this.token,
            session_id: this.sessionId,
            seq: this.lastSequence
          }
        })
      }
    })

    this.websocket.on('message', data => {
      this.handlePacket(JSON.parse(data))
    })
  }
  
  sendPacket (packet) {
    this.websocket.send(JSON.stringify(packet))
  }

  handlePacket (packet) {
    if (packet.s) this.lastSequence = packet.s
    switch (packet.op) {
      case 0: // Dispatch
        this.handleDispatch(packet)
        break
      case 1: // Heartbeat
        this.sendHeartbeat()
        break
      case 7: // Reconnect
        this.reconnect()
        break
      case 9: // Invalid Session
        this.handleInvalidSession(packet)
        break
      case 10: // Hello
        this.initializeHeartbeats(packet.d.heartbeat_interval)
        this.sendIdentify()
        break
      case 11: // Heartbeat ACK
        this.lastAckTime = Date.now()
    }
  }

  handleInvalidSession (packet) {
    if (packet.d) {
      this.reconnect()
    } else {
      this.logger.error('Invalid session')
      process.exit(1)
    }
  }

  sendIdentify () {
    this.sendPacket({
      op: 2,
      d: {
        token: this.token,
        properties: {
          $os: "linux",
          $browser: "botproject",
          $device: "botproject"
        }
      }
    })
  }

  initializeHeartbeats (interval) {
    this.sendHeartbeat()
    this.heartbeatIntervalId = setInterval(() => {
      this.sendHeartbeat()
    }, interval)
  }

  reconnect () {
    clearInterval(this.heartbeatIntervalId)
    this.websocket.close()
    this.connect()
  }

  sendHeartbeat () {
    if (this.lastHeartbeatTime > this.lastAckTime) return this.reconnect()
    this.sendPacket({
      op: 1,
      d: this.lastSequence
    })
    this.lastHeartbeatTime = Date.now()
  }

  handleDispatch (packet) {
    if (packet.t === 'READY') this.sessionId = packet.d.session_id
    this.emit('packet', packet)
    this.emit(packet.t, packet.d)
  }
}