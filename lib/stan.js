/*
 * Copyright 2016-2020 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* jshint esversion: 6 */
/* jshint node: true */
'use strict'

/**
 * Module Dependencies
 */
const util = require('util')
const nats = require('nats')
const timers = require('timers')
const events = require('events')
const nuid = require('nuid')
const proto = require('./pb')
const url = require('url')

/**
 * Constants
 */
const VERSION = require('../package.json').version
const DEFAULT_PORT = 4222
const DEFAULT_PRE = 'nats://localhost:'
const DEFAULT_URI = DEFAULT_PRE + DEFAULT_PORT
const DEFAULT_DISCOVER_PREFIX = '_STAN.discover'
const DEFAULT_ACK_PREFIX = '_STAN.acks'
const DEFAULT_CONNECT_WAIT = 1000 * 2
const DEFAULT_MAX_RECONNECT_ATTEMPTS = -1

const DEFAULT_MAX_IN_FLIGHT = 16384
const DEFAULT_ACK_WAIT = 30 * 1000

const BAD_SUBJECT = 'stan: subject must be supplied'
const BAD_CLUSTER_ID = 'stan: cluster ID must be supplied'
const BAD_CLIENT_ID = 'stan: client ID must be supplied'
const MAX_FLIGHT_LIMIT_REACHED = 'stan: max in flight reached.'
const CONN_CLOSED = 'stan: Connection closed'
const BAD_SUBSCRIPTION = 'stan: invalid subscription'
const BINARY_ENCODING_REQUIRED = 'stan: NATS connection encoding must be \'binary\'.'
const NO_SERVER_SUPPORT = 'stan: not supported by server'
const ACK_TIMEOUT = 'stan: publish ack timeout'
const CONNECT_REQ_TIMEOUT = 'stan: connect request timeout'
const CLOSE_REQ_TIMEOUT = 'stan: close request timeout'
const SUB_REQ_TIMEOUT = 'stan: subscribe request timeout'
const UNSUB_REQ_TIMEOUT = 'stan: unsubscribe request timeout'

const PROTOCOL_ONE = 1
const DEFAULT_PING_INTERVAL = 5 * 1000
const DEFAULT_PING_MAXOUT = 3
const MAX_PINGS_EXCEEDED = 'stan: connection lost due to PING failure'

/**
 * Library Version
 * @type {string}
 */
exports.version = VERSION

function Stan (clusterID, clientID, opts) {
  events.EventEmitter.call(this)
  if (typeof clusterID !== 'string' || clusterID.length < 1) {
    throw new Error(BAD_CLUSTER_ID)
  }
  if (typeof clientID !== 'string' || clientID.length < 1) {
    throw new Error(BAD_CLIENT_ID)
  }
  this.clusterID = clusterID
  this.clientID = clientID
  this.ackSubject = DEFAULT_ACK_PREFIX + '.' + nuid.next() // publish acks

  // these are set by stan
  this.pubPrefix = null // publish prefix appended to subject
  this.subRequests = null // subject for subscription requests
  this.unsubRequests = null // subject for unsubscribe requests
  this.subCloseRequests = null // subject for subscription close requests
  this.closeRequests = null // subject for close requests

  this.parseOptions(opts)
  // allow testing options
  if (opts && opts.test_opts) {
    return this
  }
  this.initState()
  this.createConnection()
  return this
}

util.inherits(Stan, events.EventEmitter)

/**
 * Connect to a nats-streaming-server and return the client.
 * @param {string} clusterID
 * @param {string} [clientID] - must be unique
 * @param {object} [opts] - object with NATS/STAN options
 * @return {Stan}
 * @public
 */
exports.connect = function (clusterID, clientID, opts) {
  return new Stan(clusterID, clientID, opts)
}

/**
 * Returns true if the connection to NATS is closed.
 * @returns {boolean}
 * @private
 */
Stan.prototype.isClosed = function () {
  return this.nc === undefined
}

/**
 * Parses the provided options
 * @param {number|string|object} opts
 * @private
 */
Stan.prototype.parseOptions = function (opts) {
  const options = this.options = {
    ackTimeout: DEFAULT_ACK_WAIT,
    connectTimeout: DEFAULT_CONNECT_WAIT,
    discoverPrefix: DEFAULT_DISCOVER_PREFIX,
    maxPubAcksInflight: DEFAULT_MAX_IN_FLIGHT,
    maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
    stanEncoding: 'utf8',
    stanMaxPingOut: DEFAULT_PING_MAXOUT,
    stanPingInterval: DEFAULT_PING_INTERVAL,
    url: DEFAULT_URI
  }

  if (opts === undefined) {
    options.url = DEFAULT_URI
  } else if (typeof opts === 'number') {
    options.url = DEFAULT_PRE + opts
  } else if (typeof opts === 'string') {
    options.url = sanitizeUrl(opts)
  } else if (typeof opts === 'object') {
    if (opts.port !== undefined) {
      options.url = DEFAULT_PRE + opts.port
    }

    this.assignOption(opts, 'ackTimeout')
    this.assignOption(opts, 'connectTimeout')
    this.assignOption(opts, 'discoverPrefix')
    this.assignOption(opts, 'maxPubAcksInflight')
    this.assignOption(opts, 'nc')
    this.assignOption(opts, 'stanEncoding')
    this.assignOption(opts, 'stanMaxPingOut')
    this.assignOption(opts, 'stanPingInterval')

    // node-nats does takes a bunch of other options we simply forward them, as node-nats is used underneath.
    // Options like json, noEcho, preserveBuffers are omitted because they don't make sense
    this.assignOption(opts, 'encoding')
    this.assignOption(opts, 'maxPingOut')
    this.assignOption(opts, 'maxReconnectAttempts')
    this.assignOption(opts, 'name')
    this.assignOption(opts, 'nkey')
    this.assignOption(opts, 'noRandomize')
    this.assignOption(opts, 'nonceSigner')
    this.assignOption(opts, 'pass')
    this.assignOption(opts, 'pedantic')
    this.assignOption(opts, 'pingInterval')
    this.assignOption(opts, 'reconnect')
    this.assignOption(opts, 'reconnectTimeWait')
    this.assignOption(opts, 'servers')
    this.assignOption(opts, 'tls')
    this.assignOption(opts, 'token')
    this.assignOption(opts, 'tokenHandler')
    this.assignOption(opts, 'url')
    this.assignOption(opts, 'useOldRequestStyle')
    this.assignOption(opts, 'user')
    this.assignOption(opts, 'userCreds')
    this.assignOption(opts, 'userJWT')
    this.assignOption(opts, 'verbose')
    this.assignOption(opts, 'waitOnFirstConnect')
    this.assignOption(opts, 'yieldTime')

    // fixme: aliasing a configuration property name should be an error
    this.assignOption(opts, 'client', 'name')
    this.assignOption(opts, 'credentials', 'userCreds')
    this.assignOption(opts, 'dontRandomize', 'noRandomize')
    this.assignOption(opts, 'jwt', 'userJWT')
    this.assignOption(opts, 'JWT', 'userJWT')
    this.assignOption(opts, 'nkeys', 'nkey')
    this.assignOption(opts, 'NoRandomize', 'noRandomize')
    this.assignOption(opts, 'password', 'pass')
    this.assignOption(opts, 'secure', 'tls')
    this.assignOption(opts, 'sig', 'nonceSigner')
    this.assignOption(opts, 'sigCB', 'nonceSigner')
    this.assignOption(opts, 'sigCallback', 'nonceSigner')
    this.assignOption(opts, 'sigcb', 'nonceSigner')
    this.assignOption(opts, 'uri', 'url')
    this.assignOption(opts, 'urls', 'servers')
    this.assignOption(opts, 'usercreds', 'userCreds')
    this.assignOption(opts, 'userjwt', 'userJWT')
  }
}

function sanitizeUrl (host) {
  if ((/^.*:\/\/.*/).exec(host) === null) {
    // Does not have a scheme.
    host = 'nats://' + host
  }
  // eslint-disable-next-line node/no-deprecated-api
  const u = new url.URL(host)
  if (u.port === null || u.port === '') {
    host += ':' + DEFAULT_PORT
  }
  return host
}

/**
 * Updates the internal option to the value from opts.
 * @param {object} opts
 * @param {string} prop - the property name
 * @param {string} [assign] is an alternate name for prop name in the target
 */
Stan.prototype.assignOption = function (opts, prop, assign) {
  if (assign === undefined) {
    assign = prop
  }
  if (opts[prop] !== undefined) {
    this.options[assign] = opts[prop]
  }
}

/**
 * Internal initializer
 */
Stan.prototype.initState = function () {
  this.pubAckMap = {}
  this.pubAckOutstanding = 0
  this.subMap = {}
}

/**
 * Connect event - emitted when the streaming protocol connection sequence  has
 * completed and the client is ready to process requests.
 *
 * @event Stan#connect
 * @type {Stan}
 */

/**
 * Close event - emitted when Stan#close() is called or its underlying NATS connection
 * closes
 *
 * @event Stan#close
 */

/**
 * Reconnecting event - emitted with the underlying NATS connection emits reconnecting
 *
 * @Event Stan#reconnecting
 */

/**
 * Error event - emitted when there's an error
 * @type {Error|object}
 *
 * Stan#error
 */

// @private
Stan.prototype.initConnection = function () {
  // heartbeat processing
  const hbInbox = nats.createInbox()
  this.hbSubscription = this.nc.subscribe(hbInbox, (msg, reply) => {
    this.nc.publish(reply)
  })

  this.pingInbox = nats.createInbox()
  this.pingSubscription = this.nc.subscribe(this.pingInbox, (msg) => {
    if (msg) {
      const pingResponse = proto.pb.PingResponse.deserializeBinary(Buffer.from(msg, 'binary'))
      const err = pingResponse.getError()
      if (err) {
        this.closeWithError('connection_lost', err)
        return
      }
    }
    this.pingOut = 0
  })

  this.ackSubscription = this.nc.subscribe(this.ackSubject, this.processAck())

  const discoverSubject = this.options.discoverPrefix + '.' + this.clusterID
  // noinspection JSUnresolvedFunction
  this.connId = Buffer.from(nuid.next(), 'utf8')
  const req = new proto.pb.ConnectRequest()
  req.setClientId(this.clientID)
  req.setHeartbeatInbox(hbInbox)
  req.setProtocol(PROTOCOL_ONE)
  req.setConnId(this.connId)
  req.setPingInterval(Math.ceil(this.options.stanPingInterval / 1000))
  req.setPingMaxOut(this.options.stanMaxPingOut)

  this.nc.requestOne(discoverSubject, Buffer.from(req.serializeBinary()), this.options.connectTimeout, (msg) => {
    if (msg instanceof nats.NatsError) {
      let err = msg
      if (msg.code === nats.REQ_TIMEOUT) {
        err = new nats.NatsError(CONNECT_REQ_TIMEOUT, CONNECT_REQ_TIMEOUT, err)
      }
      this.closeWithError('error', err)
      return
    }

    const cr = proto.pb.ConnectResponse.deserializeBinary(Buffer.from(msg, 'binary'))
    if (cr.getError() !== '') {
      this.closeWithError('error', cr.getError())
      return
    }
    this.pubPrefix = cr.getPubPrefix()
    this.subRequests = cr.getSubRequests()
    this.unsubRequests = cr.getUnsubRequests()
    this.subCloseRequests = cr.getSubCloseRequests()
    this.closeRequests = cr.getCloseRequests()

    let unsubPingSub = true
    if (cr.getProtocol() >= PROTOCOL_ONE) {
      if (cr.getPingInterval() !== 0) {
        unsubPingSub = false

        this.pingRequests = cr.getPingRequests()
        this.stanPingInterval = cr.getPingInterval() * 1000
        this.stanMaxPingOut = cr.getPingMaxOut()

        const ping = new proto.pb.Ping()
        ping.setConnId(this.connId)
        this.pingBytes = Buffer.from(ping.serializeBinary())

        this.pingOut = 0
        const that = this
        this.pingTimer = setTimeout(function pingFun () {
          that.pingOut++
          if (that.pingOut > that.stanMaxPingOut) {
            that.closeWithError('connection_lost', new Error(MAX_PINGS_EXCEEDED))
            return
          }
          that.nc.publish(that.pingRequests, that.pingBytes, that.pingInbox)
          that.pingTimer = setTimeout(pingFun, that.stanPingInterval)
        }, this.stanPingInterval)
      }
    }
    if (unsubPingSub) {
      this.nc.unsubscribe(this.pingSubscription)
      this.pingSubscription = null
    }

    this.emit('connect', this)
  })
}

// @private
Stan.prototype.setupHandlers = function () {
  // if they gave us a connection, it could be connected, so the `connect` event may never fire.
  if (!this.ncOwned && this.nc.connected) {
    this.initConnection()
  }
  this.nc.on('connect', () => {
    this.initConnection()
  })

  this.nc.on('close', () => {
    // insure we cleaned up
    this.cleanupOnClose()
    this.emit('close')
  })

  this.nc.on('disconnect', () => {
    this.emit('disconnect')
  })

  this.nc.on('reconnect', () => {
    this.emit('reconnect', this)
  })

  this.nc.on('reconnecting', () => {
    this.emit('reconnecting')
  })

  this.nc.on('error', (msg) => {
    this.emit('error', msg)
  })
}

/**
 * Connect to a NATS Streaming subsystem
 * @fires Stan#connect, Stan#close, Stan#reconnecting, Stan#error
 */
Stan.prototype.createConnection = function () {
  if (typeof this.options.nc === 'object') {
    if (this.options.nc.encoding !== 'binary') {
      throw new Error(BINARY_ENCODING_REQUIRED)
    } else {
      this.nc = this.options.nc
    }
  }
  if (this.nc === undefined) {
    const encoding = this.options.encoding
    if (encoding && encoding !== 'binary') {
      throw new Error(BINARY_ENCODING_REQUIRED)
    } else {
      this.options.encoding = 'binary'
    }
    this.nc = nats.connect(this.options)
    this.ncOwned = true
  }
  this.setupHandlers()
}

/**
 * Close stan invoking the event notification with the
 * specified error, followed by a close notification.
 * @param event
 * @param error
 * @private
 */
Stan.prototype.closeWithError = function (event, error) {
  if (this.nc === undefined || this.clientID === undefined) {
    return
  }
  this.cleanupOnClose(error)
  if (this.ncOwned) {
    this.nc.close()
  }
  this.emit(event, error)
  this.emit('close')
}

/**
 * Cleanup stan protocol subscriptions, pings and pending acks
 * @param err
 * @private
 */
Stan.prototype.cleanupOnClose = function (err) {
  // remove the ping timer
  if (this.pingTimer) {
    timers.clearTimeout(this.pingTimer)
    delete this.pingTimer
  }

  // if we don't own the connection, we unsub to insure
  // that a subsequent reconnect will properly clean up.
  // Otherwise the close() will take care of it.
  if (!this.ncOwned && this.nc) {
    if (this.ackSubscription) {
      this.nc.unsubscribe(this.ackSubscription)
      this.ackSubscription = null
    }
    if (this.pingSubscription) {
      this.nc.unsubscribe(this.pingSubscription)
      this.pingSubscription = null
    }
    if (this.hbSubscription) {
      this.nc.unsubscribe(this.hbSubscription)
      this.hbSubscription = null
    }
  }
  for (const guid in this.pubAckMap) {
    if (Object.hasOwnProperty.call(this.pubAckMap, guid)) {
      const a = this.removeAck(guid)
      if (a && a.ah && typeof a.ah === 'function') {
        a.ah(err, guid)
      }
    }
  }
}

/**
 * Closes the NATS streaming server connection, or returns if already closed.
 * @fire Stan.close, Stan.error
 *
 */
Stan.prototype.close = function () {
  if (this.nc === undefined || this.clientID === undefined) {
    return
  }
  this.cleanupOnClose(new Error(CONN_CLOSED))
  // noinspection JSUnresolvedFunction
  if (this.nc && this.closeRequests) {
    const req = new proto.pb.CloseRequest()
    req.setClientId(this.clientID)
    this.nc.requestOne(this.closeRequests, Buffer.from(req.serializeBinary()), {}, this.options.connectTimeout, (msgOrError) => {
      const nc = this.nc
      delete this.nc
      let closeError = null
      // noinspection JSUnresolvedVariable
      if (msgOrError instanceof nats.NatsError) {
        // if we get an error here, we simply show it in the close notification as there's not much we can do here.
        closeError = msgOrError
      } else {
        const cr = proto.pb.CloseResponse.deserializeBinary(Buffer.from(msgOrError, 'binary'))
        const err = cr.getError()
        if (err && err.length > 0) {
          // if the protocol returned an error there's nothing for us to handle, pass it as an arg to close notification.
          closeError = new Error(err)
        }
      }
      if (nc && this.ncOwned) {
        nc.close()
      }
      this.emit('close', closeError)
    })
  } else {
    if (this.nc && this.ncOwned) {
      this.nc.close()
      delete this.nc
    }
    this.emit('close')
  }
}

/**
 * @return {Function} for processing acks associated with the protocol
 * @protected
 */
Stan.prototype.processAck = function () {
  return (msg) => {
    // noinspection JSUnresolvedVariable
    const pa = proto.pb.PubAck.deserializeBinary(Buffer.from(msg, 'binary'))
    const guid = pa.getGuid()
    const a = this.removeAck(guid)
    if (a && a.ah) {
      const err = pa.getError()
      a.ah(err === '' ? undefined : err, guid)
    }
  }
}

/**
 * Removes Ack for the specified guid from the outstanding ack list
 * @param {string} guid
 * @return {object}
 * @protected
 */
Stan.prototype.removeAck = function (guid) {
  const a = this.pubAckMap[guid]
  if (a !== undefined) {
    delete this.pubAckMap[guid]
    this.pubAckOutstanding--
    if (a.t !== undefined) {
      // noinspection JSUnresolvedFunction
      timers.clearTimeout(a.t)
    }
  }
  return a
}

/**
 * Publishes a message to the streaming server with the specified subject and data.
 * Data can be {Uint8Array|string|Buffer}. The ackHandler is called with any errors or
 * empty string, and the guid for the published message.
 *
 * Note that if the maxPubAcksInflight option is exceeded, the ackHandler will be called
 * with an error. If no ackHandler was provided, an exception is thrown.
 * @param subject
 * @param data {Uint8Array|string|Buffer}
 * @param ackHandler(err,guid)
 */
Stan.prototype.publish = function (subject, data, ackHandler) {
  if (this.nc === undefined) {
    if (typeof ackHandler === 'function') {
      ackHandler(new Error(CONN_CLOSED))
      return
    } else {
      throw new Error(CONN_CLOSED)
    }
  }

  if (this.pubAckOutstanding > this.options.maxPubAcksInflight) {
    // we have many pending publish messages, fail it.
    if (typeof ackHandler === 'function') {
      ackHandler(new Error(MAX_FLIGHT_LIMIT_REACHED))
    } else {
      throw new Error(MAX_FLIGHT_LIMIT_REACHED)
    }
  }

  const subj = this.pubPrefix + '.' + subject
  const peGUID = nuid.next()
  // noinspection JSUnresolvedFunction
  const pe = new proto.pb.PubMsg()
  pe.setClientId(this.clientID)
  pe.setConnId(this.connId)
  pe.setGuid(peGUID)
  pe.setSubject(subject)
  let buf
  if (typeof data === 'string') {
    buf = Buffer.from(data, 'utf8')
    data = new Uint8Array(buf)
  } else if (Object.isPrototypeOf.call(Buffer.prototype, data)) {
    buf = Buffer.from(data, 'utf8')
    data = new Uint8Array(buf)
  } else if (Object.isPrototypeOf.call(Buffer.prototype, Uint8Array)) {
    // we already handle this
  }

  pe.setData(data)

  const ack = {}
  ack.ah = ackHandler
  this.pubAckMap[peGUID] = ack

  const bytes = Buffer.from(pe.serializeBinary())
  this.nc.publish(subj, bytes, this.ackSubject)
  this.pubAckOutstanding++

  // all acks are received in ackSubject, so not possible to reuse nats.timeout
  // noinspection JSUnresolvedFunction
  ack.t = timers.setTimeout(() => {
    const a = this.removeAck(peGUID)
    if (a && a.ah !== undefined) {
      a.ah(new Error(ACK_TIMEOUT), peGUID)
    }
  }, this.options.ackTimeout)

  return peGUID
}

/**
 * Creates a NATS streaming server subscription on the specified subject. If qGroup
 * is provided, the subscription will be distributed between all subscribers using
 * the same qGroup name.
 * @param {String} subject
 * @param {String} [qGroup]
 * @param {SubscriptionOptions} [options]
 * @throws err if the subject is not provided
 * @fires Stan#error({Error})
 * @returns Subscription
 */
Stan.prototype.subscribe = function (subject, qGroup, options) {
  const args = {}
  if (typeof qGroup === 'string') {
    args.qGroup = qGroup
  } else if (typeof qGroup === 'object') {
    args.options = qGroup
  }
  if (typeof options === 'object') {
    args.options = options
  }
  if (!args.options) {
    args.options = new SubscriptionOptions()
  }

  // in node-nats there's no Subscription object...
  const retVal = new Subscription(this, subject, args.qGroup, nats.createInbox(), args.options, args.callback)

  if (typeof subject !== 'string' || subject.length === 0) {
    process.nextTick(() => {
      retVal.emit('error', new Error(BAD_SUBJECT))
    })
    return retVal
  }

  if (this.isClosed()) {
    process.nextTick(() => {
      retVal.emit('error', new Error(CONN_CLOSED))
    })
    return retVal
  }

  this.subMap[retVal.inbox] = retVal
  retVal.inboxSub = this.nc.subscribe(retVal.inbox, this.processMsg())
  const sr = new proto.pb.SubscriptionRequest()
  sr.setClientId(this.clientID)
  sr.setSubject(subject)
  sr.setQGroup(retVal.qGroup || '')
  sr.setInbox(retVal.inbox)
  sr.setMaxInFlight(retVal.opts.maxInFlight)
  sr.setAckWaitInSecs(retVal.opts.ackWait / 1000)
  sr.setStartPosition(retVal.opts.startPosition)
  sr.setDurableName(retVal.opts.durableName || '')

  switch (sr.getStartPosition()) {
    case proto.pb.StartPosition.TIME_DELTA_START:
      sr.setStartTimeDelta(retVal.opts.startTime)
      break
    case proto.pb.StartPosition.SEQUENCE_START:
      sr.setStartSequence(retVal.opts.startSequence)
      break
  }

  this.nc.requestOne(this.subRequests, Buffer.from(sr.serializeBinary()), this.options.connectTimeout, (msg) => {
    if (msg instanceof nats.NatsError) {
      if (msg.code === nats.REQ_TIMEOUT) {
        const err = new nats.NatsError(SUB_REQ_TIMEOUT, SUB_REQ_TIMEOUT, msg)
        retVal.emit('timeout', err)
      } else {
        retVal.emit('error', msg)
      }
      return
    }
    // noinspection JSUnresolvedVariable
    const r = proto.pb.SubscriptionResponse.deserializeBinary(Buffer.from(msg, 'binary'))
    const err = r.getError()
    if (err && err.length !== 0) {
      retVal.emit('error', new Error(err))
      this.nc.unsubscribe(retVal.inboxSub)
      retVal.emit('unsubscribed')
      return
    }
    retVal.ackInbox = r.getAckInbox()
    retVal.emit('ready')
  })

  return retVal
}

/**
 * A NATS streaming subscription is an {event.EventEmitter} representing a subscription to the
 * server. The subscription will be ready to receive messages after the Subscription#ready notification.
 * fires. Messages are delivered on the Subscription#message(msg) notificatication.
 * @param stanConnection
 * @param subject
 * @param qGroup
 * @param inbox
 * @param opts
 * @constructor
 * @fires Subscription#error({Error}), Subscription#unsubscribed, Subscription#ready, Subscription#timeout({Error})
 *    Subscription#message({Message})
 */
function Subscription (stanConnection, subject, qGroup, inbox, opts) {
  this.stanConnection = stanConnection
  this.subject = subject
  this.qGroup = qGroup
  this.inbox = inbox
  this.opts = opts
  this.ackInbox = undefined
  this.inboxSub = undefined
}

/**
 * Error event - if there's an error with setting up the subscription, such
 * as the connection is closed or the server returns an error.
 *
 * @event Subscription#Error
 * @type Error
 */

/**
 * Timeout event - An error notification indicating that the operation timeout.
 *
 * @event Subscription#Timeout
 * @type Error
 */

/**
 * Unsubscribed event - notification that the unsubscribe request was processed by the server
 *
 * @event Subscription#unsubscribed
 */

/**
 * Ready event - notification that the subscription request was processed by the server
 *
 * @event Subscription#ready
 */

/**
 * Message event - notification that the subscription received a message from the server
 * @event Subscription#message
 * @type {Message}
 */

util.inherits(Subscription, events.EventEmitter)

/**
 * Returns true if the subscription has been closed or unsubscribed from.
 * @returns {boolean}
 */
Subscription.prototype.isClosed = function () {
  return this.stanConnection === undefined
}

/**
 * Unregisters the subscription from the streaming server. You cannot unsubscribe
 * from the server unless the Subscription#ready notification has already fired.
 * @fires Subscription#error({Error}, Subscription#unsubscribed, Subscription#timeout({Error}
 */
Subscription.prototype.unsubscribe = function () {
  this.closeOrUnsubscribe(false)
}

/**
 * Close removes the subscriber from the server, but unlike the Subscription#unsubscribe(),
 * the durable interest is not removed. If the client has connected to a server
 * for which this feature is not available, Subscription#Close() will emit a
 * Subscription#error(NO_SERVER_SUPPORT) error. Note that this affects durable clients only.
 * If called on a non-durable subscriber, this is equivalent to Subscription#close()
 *
 * @fires Subscription#error({Error}, Subscription#closed
 */
Subscription.prototype.close = function () {
  this.closeOrUnsubscribe(true)
}

/**
 * @param doClose
 * @private
 */
Subscription.prototype.closeOrUnsubscribe = function (doClose) {
  if (this.isClosed()) {
    this.emit('error', new Error(BAD_SUBSCRIPTION))
    return
  }

  const sc = this.stanConnection
  delete this.stanConnection
  delete sc.subMap[this.inbox]

  if (sc.isClosed()) {
    this.emit('error', new Error(CONN_CLOSED))
    return
  }

  let reqSubject = sc.unsubRequests
  if (doClose) {
    reqSubject = sc.subCloseRequests
    if (!reqSubject) {
      this.emit('error', new Error(NO_SERVER_SUPPORT))
    }
  }

  sc.nc.unsubscribe(this.inboxSub)
  // noinspection JSUnresolvedFunction
  const ur = new proto.pb.UnsubscribeRequest()
  ur.setClientId(sc.clientID)
  ur.setSubject(this.subject)
  ur.setInbox(this.ackInbox)

  sc.nc.requestOne(reqSubject, Buffer.from(ur.serializeBinary()), sc.options.connectTimeout, (msg) => {
    let err
    if (msg instanceof nats.NatsError) {
      const type = doClose ? CLOSE_REQ_TIMEOUT : UNSUB_REQ_TIMEOUT
      err = new nats.NatsError(type, type, msg)
      if (msg.code === nats.REQ_TIMEOUT) {
        this.emit('timeout', err)
      } else {
        this.emit('error', err)
      }
      return
    }
    // noinspection JSUnresolvedVariable
    const r = proto.pb.SubscriptionResponse.deserializeBinary(Buffer.from(msg, 'binary'))
    err = r.getError()
    if (err && err.length > 0) {
      this.emit('error', new Error(r.getError()))
    } else {
      this.emit(doClose ? 'closed' : 'unsubscribed')
    }
  })
}

/**
 * Internal function to process in-bound messages.
 * @return {Function}
 * @private
 */
Stan.prototype.processMsg = function () {
  // curry
  return (rawMsg, reply, subject) => {
    const sub = this.subMap[subject]
    try {
      // noinspection JSUnresolvedVariable
      const m = proto.pb.MsgProto.deserializeBinary(Buffer.from(rawMsg, 'binary'))
      if (sub === undefined || !this.nc) {
        return
      }
      const msg = new Message(this, m, sub)
      sub.emit('message', msg)
      msg.maybeAutoAck()
    } catch (error) {
      sub.emit('error', error)
    }
  }
}

/**
 * Represents a message received from the streaming server.
 * @param stanClient
 * @param msg
 * @param subscription
 * @constructor
 */
function Message (stanClient, msg, subscription) {
  this.stanClient = stanClient
  this.msg = msg
  this.subscription = subscription
}

/**
 * Returns the sequence number of the message.
 * @returns {number}
 */
Message.prototype.getSequence = function () {
  return this.msg.getSequence()
}

/**
 * Returns the subject the message was published on
 * @returns {string}
 */
Message.prototype.getSubject = function () {
  return this.msg.getSubject()
}

/**
 * Returns a Buffer object with the raw message payload.
 * @returns {Buffer}
 */
Message.prototype.getRawData = function () {
  return Buffer.from(this.msg.getData(), 'binary')
}

/**
 * Convenience API to convert the results of Message#getRawData to
 * a string with the specified 'stanEncoding'. Note that if the encoding
 * is set to binary, this method returns Message#getRawData.
 * @returns {!(string|Uint8Array)|string}
 */
Message.prototype.getData = function () {
  let bytes = this.msg.getData()
  const encoding = this.stanClient.options.stanEncoding
  if (encoding !== 'binary') {
    bytes = bytes.length > 0 ? Buffer.from(bytes, encoding).toString() : ''
  }
  return bytes
}

/**
 * Returns the raw timestamp. The NATS streaming server returns a 64bit nanosecond resolution
 * timestamp that is not quite useful in JavaScript. Use Message#getTimestamp to read
 * a timestamp as a Date.
 * @returns {number}
 */
Message.prototype.getTimestampRaw = function () {
  return this.msg.getTimestamp()
}

/**
 * Returns Message#getTimestampRaw as a JavaScript Date.
 * @returns {Date}
 */
Message.prototype.getTimestamp = function () {
  return new Date(this.getTimestampRaw() / 1000000)
}

/**
 * Returns true if this message is being redelivered.
 * @returns {boolean}
 */
Message.prototype.isRedelivered = function () {
  return this.msg.getRedelivered()
}

/**
 * Returns number of times the message has been redelivered
 * @returns {number}
 */
Message.prototype.getRedeliveryCount = function () {
  return this.msg.getRedeliveryCount()
}

/**
 * Returns the CRC32 of the message if provided.
 * @returns {number}
 */
Message.prototype.getCrc32 = function () {
  return this.msg.getCrc32()
}

/**
 * Calls Message.ack if the subscription was specified to
 * use manualAcks.
 * @type {Message.ack}
 * @protected
 */
Message.prototype.maybeAutoAck = function () {
  if (!this.subscription.opts.manualAcks) {
    this.ack()
  }
}

/**
 * Acks the message, note this method shouldn't be called unless
 * the manualAcks option was set on the subscription.
 */
Message.prototype.ack = function () {
  if (!this.subscription.isClosed()) {
    const ack = new proto.pb.Ack()
    ack.setSubject(this.getSubject())
    ack.setSequence(this.getSequence())
    this.stanClient.nc.publish(this.subscription.ackInbox, Buffer.from(ack.serializeBinary()))
  }
}

/**
 *
 * @returns {!(string|Uint8Array)}
 */
Message.prototype.getClientID = function () {
  return this.msg.getConnId()
}

Message.prototype.getConnectionID = function () {
  return this.msg.getClientId()
}

/**
 * Returns an object with various constants for StartPosition (NEW_ONLY,
 * LAST_RECEIVED, TIME_DELTA_START, SEQUENCE_START, FIRST)
 * @type {StartPosition}
 */
exports.StartPosition = proto.pb.StartPosition

function SubscriptionOptions (durableName, maxInFlight, ackWait, startPosition, startSequence, startTime, manualAcks) {
  // DurableName, if set will survive client restarts.
  this.durableName = durableName
  // Controls the number of messages the cluster will have inflight without an ACK.
  this.maxInFlight = maxInFlight || DEFAULT_MAX_IN_FLIGHT
  // Controls the time the cluster will wait for an ACK for a given message.
  this.ackWait = ackWait || DEFAULT_ACK_WAIT
  // StartPosition enum from proto.pb
  this.startPosition = startPosition
  // Optional start sequence number.
  this.startSequence = startSequence
  // Optional start time.
  this.startTime = startTime
  // Option to do Manual Acks
  this.manualAcks = manualAcks
}

/**
 * Returns a SubscriptionOptions initialized to the defaults
 * @return {SubscriptionOptions}
 */
Stan.prototype.subscriptionOptions = function () {
  return new SubscriptionOptions()
}

/**
 * @param n
 * @returns {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setMaxInFlight = function (n) {
  this.maxInFlight = n
  return this
}

SubscriptionOptions.prototype.setAckWait = function (millis) {
  this.ackWait = millis
  return this
}

SubscriptionOptions.prototype.setStartAt = function (startPosition) {
  this.startPosition = startPosition
  return this
}

SubscriptionOptions.prototype.setStartAtSequence = function (sequence) {
  this.startPosition = proto.pb.StartPosition.SEQUENCE_START
  this.startSequence = sequence
  return this
}

/**
 * @param {Date} date
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setStartTime = function (date) {
  this.startPosition = proto.pb.StartPosition.TIME_DELTA_START
  // server expects values in ns
  this.startTime = (Date.now() - date.valueOf()) * 1000000
  return this
}

/**
 * @param {Number} millis
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setStartAtTimeDelta = function (millis) {
  this.startPosition = proto.pb.StartPosition.TIME_DELTA_START
  // noinspection JSUnresolvedFunction
  // server expects values in ns
  this.startTime = millis * 1000000
  return this
}

/**
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setStartWithLastReceived = function () {
  this.startPosition = proto.pb.StartPosition.LAST_RECEIVED
  return this
}

/**
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setDeliverAllAvailable = function () {
  this.startPosition = proto.pb.StartPosition.FIRST
  return this
}

/**
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setManualAckMode = function (tf) {
  this.manualAcks = tf
  return this
}

/**
 * @param {String} durableName
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setDurableName = function (durableName) {
  this.durableName = durableName
  return this
}
