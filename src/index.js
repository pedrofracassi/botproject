require('dotenv').config()

const GatewayManager = require('./GatewayManager')

const logger = console

if (!process.env.DISCORD_TOKEN) {
  logger.error('Missing DISCORD_TOKEN environment variable')
  process.exit(0)
}

function initialize (token) {
  const redisClient = redis.createClient()
  redisClient.on('ready', () => {
    const gateway = new GatewayManager({ token })
    gateway.connect()

    gateway.on('GUILD_CREATE', guild => {
      console.log(guild.id)
      redisClient.hmset(`members:${guild.id}`, guild.members.map(member => [ member.user.id, JSON.stringify(member) ]).flat())
      redisClient.hmset(`presences:${guild.id}`, guild.presences.map(presence => [ presence.user.id, JSON.stringify(presence) ]).flat())
    })
  })
}

initialize(process.env.DISCORD_TOKEN)