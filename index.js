const net = require('net')
const config = require("./config.json")
const Crypto = require("./Crypto/RC4")
const MessageFactory = require('./Protocol/MessageFactory')
const server = new net.Server()
const Messages = new MessageFactory(config.useLegacyPacketLoader)
const MessagesHandler = require("./Networking/MessagesHandler")
const Queue = require("./Networking/Queue")
require("colors"), require("./Utils/Logger");

const PORT = config.port

global.sessions = []

const clearSession = (session) => sessions = sessions.filter(otherSession => otherSession.id != session.id)



server.on('connection', async (session) => {
  session.setNoDelay(true)
  session.setTimeout(config.sessionTimeoutSeconds * 1000)

  session.ip = session.remoteAddress.split(':').slice(-1);

  session.log = (text) => Client(session.ip, text)
  session.warn = (text) => ClientWarn(session.ip, text)
  session.errLog = (text) => ClientError(session.ip, text)

  session.crypto = new Crypto(config.crypto.keys.key, config.crypto.keys.nonce)

  session.id = sessions.length == 0 ? 1 : sessions[sessions.length - 1].id + 1

  session.queue = new Queue(config.maxQueueSize, config.disableQueuebugtxtFile)

  global.sessions.push(session)

  session.log(`A wild connection appeard! (SESSIONID: ${session.id})`)
  
  const packets = Messages.getAllPackets();
  const MessageHandler = new MessagesHandler(session, packets)

  session.on('data', async (bytes) => {
    let messageHeader = {}

    session.queue.push(bytes)

    switch (session.queue.state) {
      case session.queue.QUEUE_OVERFILLED:
        if (config.enableQueueOverfillingWarning) session.warn(`Queue is overfilled! Queue size: ${session.queue.size()}`)

        if (config.disconnectSessionOnQueueOverfilling) {
          session.warn(`Client disconnected.`)
          clearSession(session)
          session.destroy()
        }
      break;
      case session.queue.QUEUE_PUSHED_MORE_THAN_EXPECTED:
        session.warn(`Queue got more bytes than expected! Expected: ${session.queue.getQueueExpectedSize()} size. Got: ${session.queue.size()} size.`)
      break;
      case session.queue.QUEUE_DETECTED_MERGED_PACKETS:
        session.warn(`Queue detected merged packets!`)
      break;
    }

    if (!session.queue.isBusy()) {
      const queueBytes = session.queue.release()

      if (Array.isArray(queueBytes)) {
        session.log("Handling merged packets...")
        for(let packet of queueBytes) {
          if (config.crypto.activate) {
            packet.bytes = await session.crypto.decrypt(packet.bytes)
          }
          
          await MessageHandler.handle(packet.id, packet.bytes, { })
        }

        return session.log("Merged packets was handled.")
      }
      
      messageHeader = {
        id: queueBytes.readUInt16BE(0),
        len: queueBytes.readUIntBE(2, 3),
        version: queueBytes.readUInt16BE(5),
        bytes: queueBytes.slice(7, this.len)
      }
      if (config.crypto.activate) {
        messageHeader.bytes = await session.crypto.decrypt(messageHeader.bytes)
      }
  
      await MessageHandler.handle(messageHeader.id, messageHeader.bytes, {})

    }
  })

  session.on('end', async () => {
    clearSession(session)
    session.log('Client disconnected.')
    return session.destroy() 
  })

  session.on('error', async error => {
    try {
      clearSession(session)
      session.errLog('A wild error!')
      console.error(error)
      return session.destroy()
    } catch (e) { }
  })

  session.on('timeout', async () => {
    clearSession(session)
    session.warn('Session timeout was reached.')
    return session.destroy()
  })
})

server.once('listening', () => ServerLog(`${config.serverName} started on ${PORT} port!`))
server.listen(PORT)

process.on("uncaughtException", e => Warn(e.stack));

process.on("unhandledRejection", e => Warn(e.stack));
