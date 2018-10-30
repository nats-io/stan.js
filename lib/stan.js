/*
 * Copyright 2016-2018 The NATS Authors
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
'use strict';

/**
 * Module Dependencies
 */
var util = require('util'),
    nats = require('nats'),
    timers = require('timers'),
    events = require('events'),
    nuid = require('nuid'),
    proto = require('./pb');

/**
 * Constants
 */
var VERSION = '0.0.50',
DEFAULT_PORT = 4222,
DEFAULT_PRE = 'nats://localhost:',
DEFAULT_URI = DEFAULT_PRE + DEFAULT_PORT,
DEFAULT_DISCOVER_PREFIX = '_STAN.discover',
DEFAULT_ACK_PREFIX = '_STAN.acks',
DEFAULT_CONNECT_WAIT = 1000 * 2,

DEFAULT_MAX_IN_FLIGHT = 16384,
DEFAULT_ACK_WAIT = 30 * 1000,

BAD_SUBJECT = 'stan: subject must be supplied',
BAD_CLUSTER_ID = 'stan: cluster ID must be supplied',
BAD_CLIENT_ID = 'stan: client ID must be supplied',
MAX_FLIGHT_LIMIT_REACHED = 'stan: max in flight reached.',
CONN_CLOSED = 'stan: Connection closed',
BAD_SUBSCRIPTION = 'stan: invalid subscription',
BINARY_ENCODING_REQUIRED = 'stan: NATS connection encoding must be \'binary\'.',
NO_SERVER_SUPPORT = 'stan: not supported by server',
ACK_TIMEOUT = 'stan: publish ack timeout',
CONNECT_REQ_TIMEOUT = 'stan: connect request timeout',
CLOSE_REQ_TIMEOUT   = 'stan: close request timeout',
SUB_REQ_TIMEOUT     = 'stan: subscribe request timeout',
UNSUB_REQ_TIMEOUT   = 'stan: unsubscribe request timeout';

/**
 * Library Version
 * @type {string}
 */
exports.version = VERSION;


function Stan(clusterID, clientID, opts) {
  events.EventEmitter.call(this);
  if(typeof clusterID !== 'string' || clusterID.length < 1) {
    throw new Error(BAD_CLUSTER_ID);
  }
  if(typeof clientID !== 'string' || clientID.length < 1) {
    throw new Error(BAD_CLIENT_ID);
  }
  this.clusterID = clusterID;
  this.clientID = clientID;
  this.ackSubject = DEFAULT_ACK_PREFIX + "." + nuid.next(); // publish acks

  // these are set by stan
  this.pubPrefix = null;  // publish prefix appended to subject
  this.subRequests = null;  // subject for subscription requests
  this.unsubRequests = null;  // subject for unsubscribe requests
  this.subCloseRequests = null; // subject for subscription close requests
  this.closeRequests = null;  // subject for close requests

  this.parseOptions(opts);
  this.initState();
  this.createConnection();
  return this;
}


util.inherits(Stan, events.EventEmitter);

/**
 * Connect to a nats-streaming-server and return the client.
 * @param {string} clusterID
 * @param {string} [clientID] - must be unique
 * @param {object} [opts] - object with NATS/STAN options
 * @return {Stan}
 * @public
 */
exports.connect = function(clusterID, clientID, opts) {
  return new Stan(clusterID, clientID, opts);
};

/**
 * Returns true if the connection to NATS streaming server is closed.
 * @returns {boolean}
 */
Stan.prototype.isClosed = function() {
  return this.nc === undefined;
};

/**
 * Parses the provided options
 * @param {number|string|object} opts
 * @private
 */
Stan.prototype.parseOptions = function(opts) {
  var options = this.options = {
    url: DEFAULT_URI,
    connectTimeout: DEFAULT_CONNECT_WAIT,
    ackTimeout: DEFAULT_ACK_WAIT,
    discoverPrefix: DEFAULT_DISCOVER_PREFIX,
    maxPubAcksInflight: DEFAULT_MAX_IN_FLIGHT,
    stanEncoding: 'utf8'
  };

  if (opts === undefined) {
    options.url = DEFAULT_URI;
  } else if ('number' === typeof opts) {
    options.url = DEFAULT_PRE + opts;
  } else if ('string' === typeof opts) {
    options.url = opts;
  } else if ('object' === typeof opts) {
    this.assignOption(opts, 'discoverPrefix');
    this.assignOption(opts, 'nc');
    this.assignOption(opts, 'connectTimeout');
    this.assignOption(opts, 'ackTimeout');
    this.assignOption(opts, 'maxPubAcksInflight');
    this.assignOption(opts, 'stanEncoding');

    // node-nats does takes a bunch of other options
    // we simply forward them, as node-nats is used
    // underneath.
    this.assignOption(opts, 'url');
    this.assignOption(opts, 'uri', 'url');
    this.assignOption(opts, 'user');
    this.assignOption(opts, 'pass');
    this.assignOption(opts, 'token');
    this.assignOption(opts, 'password', 'pass');
    this.assignOption(opts, 'verbose');
    this.assignOption(opts, 'pedantic');
    this.assignOption(opts, 'reconnect');
    this.assignOption(opts, 'maxReconnectAttempts');
    this.assignOption(opts, 'reconnectTimeWait');
    this.assignOption(opts, 'servers');
    this.assignOption(opts, 'urls', 'servers');
    this.assignOption(opts, 'noRandomize');
    this.assignOption(opts, 'NoRandomize', 'noRandomize');
    this.assignOption(opts, 'dontRandomize', 'noRandomize');
    this.assignOption(opts, 'encoding');
    this.assignOption(opts, 'tls');
    this.assignOption(opts, 'secure', 'tls');
    this.assignOption(opts, 'name');
    this.assignOption(opts, 'client', 'name');
    this.assignOption(opts, 'yieldTime');
    this.assignOption(opts, 'waitOnFirstConnect');
  }
};


/**
 * Updates the internal option to the value from opts.
 * @param {object} opts
 * @param {string} prop - the property name
 * @param {string} [assign] is an alternate name for prop name in the target
 */
Stan.prototype.assignOption = function(opts, prop, assign) {
  if (assign === undefined) {
    assign = prop;
  }
  if (opts[prop] !== undefined) {
    this.options[assign] = opts[prop];
  }
};


/**
 * Internal initializer
 */
Stan.prototype.initState = function() {
  this.pubAckMap = {};
  this.pubAckOutstanding = 0;
  this.subMap = {};
};

Buffer.prototype.toByteArray = function() {
  return Array.prototype.slice.call(this, 0);
};

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

/**
 * Connect to a NATS Streaming subsystem
 * @fires Stan#connect, Stan#close, Stan#reconnecting, Stan#error
 */
Stan.prototype.createConnection = function() {
  var that = this;

  if(typeof this.options.nc === 'object') {
    if(this.options.nc.encoding !== 'binary') {
     throw new Error(BINARY_ENCODING_REQUIRED);
    } else {
      this.nc = this.options.nc;
    }
  }
  if (this.nc === undefined) {
    var encoding = this.options.encoding;
    if(encoding && encoding !== 'binary') {
      throw new Error(BINARY_ENCODING_REQUIRED);
    } else {
      this.options.encoding = 'binary';
    }
    this.nc = nats.connect(this.options);
    this.ncOwned = true;
  }


  this.nc.on('connect', function() {
    // heartbeat processing
    var hbInbox = nats.createInbox();
    that.hbSubscription = that.nc.subscribe(hbInbox, function(msg, reply) {
      that.nc.publish(reply);
    });

    that.ackSubscription = that.nc.subscribe(that.ackSubject, that.processAck());

    var discoverSubject = that.options.discoverPrefix + '.' + that.clusterID;
    //noinspection JSUnresolvedFunction
    var req = new proto.ConnectRequest();
    req.setClientId(that.clientID);
    req.setHeartbeatInbox(hbInbox);

    // cleanup the connection
    function cleanupConnection(error) {
      that.emit('error', error);
      var nc = that.nc;
      delete that.nc;
      nc.flush(function(){
        if (that.ncOwned) {
          nc.close();
          that.emit('close');
        }
      });
    }

    // fixme: hardcoded timeout
    that.nc.requestOne(discoverSubject, Buffer.from(req.serializeBinary()), 2*1000, function(msg) {
      if(msg instanceof nats.NatsError) {
        cleanupConnection(msg);
        return;
      }

      var cr = proto.ConnectResponse.deserializeBinary(Buffer.from(msg, 'binary').toByteArray());
      if (cr.getError() !== "") {
        cleanupConnection(cr.getError());
        return;
      }
      that.pubPrefix = cr.getPubPrefix();
      that.subRequests = cr.getSubRequests();
      that.unsubRequests = cr.getUnsubRequests();
      that.subCloseRequests = cr.getSubCloseRequests();
      that.closeRequests = cr.getCloseRequests();
      that.emit('connect', that);
    });
  });

  this.nc.on('close', function() {
    that.emit('close');
  });

  this.nc.on('disconnect', function() {
    that.emit('disconnect');
  });

  this.nc.on('reconnect', function() {
    that.emit('reconnect', that);
  });

  this.nc.on('reconnecting', function() {
    that.emit('reconnecting');
  });

  this.nc.on('error', function(msg) {
    that.emit('error', msg);
  });
};


/**
 * Closes the NATS streaming server connection, or returns if already closed.
 * @fire Stan.close, Stan.error
 *
 */
Stan.prototype.close = function() {
  if (this.nc === undefined || this.clientID === undefined) {
    return;
  }
  if (this.ackSubscription !== null) {
    this.nc.unsubscribe(this.ackSubscription);
  }
  var that = this;

  //noinspection JSUnresolvedFunction
  var req = new proto.CloseRequest();
  req.setClientId(this.clientID);
  this.nc.requestOne(this.closeRequests, Buffer.from(req.serializeBinary()), {}, that.options.connectTimeout, function(msgOrError) {
    var nc = that.nc;
    delete that.nc;
    //noinspection JSUnresolvedVariable
    if(msgOrError instanceof nats.NatsError) {
      that.emit('error', msgOrError);
    } else {
        var cr = proto.CloseResponse.deserializeBinary(Buffer.from(msgOrError, 'binary').toByteArray());
        var err = cr.getError();
        if (err && err.length > 0) {
            that.emit('error', new Error(err));
        }
    }
    // go closes always
    if (that.ncOwned) {
      nc.close();
      that.emit('close');
    }
  });
};

/**
 * @return {Function} for processing acks associated with the protocol
 * @protected
 */
Stan.prototype.processAck = function() {
  var that = this;
  return function(msg) {
    //noinspection JSUnresolvedVariable
    var pa = proto.PubAck.deserializeBinary(Buffer.from(msg, 'binary').toByteArray());
    var guid = pa.getGuid();
    var a = that.removeAck(guid);
    if(a && a.ah) {
      var err = pa.getError();
      a.ah(err === '' ? undefined : err, guid);
    }
  };
};

/**
 * Removes Ack for the specified guid from the outstanding ack list
 * @param {string} guid
 * @return {object}
 * @protected
 */
Stan.prototype.removeAck = function(guid) {
  var a = this.pubAckMap[guid];
  if (a !== undefined) {
    delete this.pubAckMap[guid];
    this.pubAckOutstanding--;
    if (a.t !== undefined) {
      //noinspection JSUnresolvedFunction
      timers.clearTimeout(a.t);
    }
  }
  return a;
};

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
Stan.prototype.publish = function(subject, data, ackHandler) {
  if (this.nc === undefined) {
    if (util.isFunction(ackHandler)) {
      ackHandler(new Error(CONN_CLOSED));
      return;
    } else {
      throw new Error(CONN_CLOSED);
    }
  }

  if(this.pubAckOutstanding > this.options.maxPubAcksInflight) {
    // we have many pending publish messages, fail it.
    if(util.isFunction(ackHandler)) {
      ackHandler(new Error(MAX_FLIGHT_LIMIT_REACHED));
    } else {
      throw new Error(MAX_FLIGHT_LIMIT_REACHED);
    }
  }

  var subj = this.pubPrefix + '.' + subject;
  var peGUID = nuid.next();
  //noinspection JSUnresolvedFunction
  var pe = new proto.PubMsg();
  pe.setClientId(this.clientID);
  pe.setGuid(peGUID);
  pe.setSubject(subject);
  var buf;
  if(typeof data === 'string') {
    buf = Buffer.from(data, 'utf8');
    data = new Uint8Array(buf);
  } else if(Buffer.prototype.isPrototypeOf(data)) {
    buf = Buffer.from(data, 'utf8');
    data = new Uint8Array(buf);
  } else if(Buffer.prototype.isPrototypeOf(Uint8Array)) {
    // we already handle this
  }

  pe.setData(data);

  var ack = {};
  ack.ah = ackHandler;
  this.pubAckMap[peGUID] = ack;

  var that = this;
  var bytes = Buffer.from(pe.serializeBinary());
  this.nc.publish(subj, bytes, this.ackSubject);
  this.pubAckOutstanding++;

  // all acks are received in ackSubject, so not possible to reuse nats.timeout
  //noinspection JSUnresolvedFunction
  ack.t = timers.setTimeout(function() {
    var _ack = that.removeAck(peGUID);
    if(_ack && _ack.ah !== undefined) {
      _ack.ah(new Error(ACK_TIMEOUT), peGUID);
    }
  }, this.options.ackTimeout);

  return peGUID;
};


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
Stan.prototype.subscribe = function(subject, qGroup, options) {
  var that = this;

  var args = {};
  if (typeof qGroup === 'string') {
    args.qGroup = qGroup;
  }
  else if (typeof qGroup === 'object') {
    args.options = qGroup;
  }
  if (typeof options === 'object') {
    args.options = options;
  }
  if (!args.options) {
    args.options = new SubscriptionOptions();
  }

  // in node-nats there's no Subscription object...
  var retVal = new Subscription(this, subject, args.qGroup, nats.createInbox(), args.options, args.callback);

  if (typeof subject !== 'string' || subject.length === 0) {
    process.nextTick(function() {
      that.emit('error', new Error(BAD_SUBJECT));
    });
    return retVal;
  }

  if(this.isClosed()) {
    process.nextTick(function() {
      that.emit('error', new Error(CONN_CLOSED));
    });
    return retVal;
  }

  this.subMap[retVal.inbox] = retVal;
  retVal.inboxSub = this.nc.subscribe(retVal.inbox, this.processMsg());
  var sr = new proto.SubscriptionRequest();
  sr.setClientId(this.clientID);
  sr.setSubject(subject);
  sr.setQGroup(retVal.qGroup || '');
  sr.setInbox(retVal.inbox);
  sr.setMaxInFlight(retVal.opts.maxInFlight);
  sr.setAckWaitInSecs(retVal.opts.ackWait / 1000);
  sr.setStartPosition(retVal.opts.startPosition);
  sr.setDurableName(retVal.opts.durableName || '');

  switch (sr.getStartPosition()) {
    case proto.StartPosition.TIME_DELTA_START:
      sr.setStartTimeDelta(retVal.opts.startTime);
      break;
    case proto.StartPosition.SEQUENCE_START:
      sr.setStartSequence(retVal.opts.startSequence);
      break;
  }

  // fixme: hardcoded timeout
  this.nc.requestOne(this.subRequests, Buffer.from(sr.serializeBinary()), 2*1000, function(msg) {
    if(msg instanceof nats.NatsError) {
      if(msg.code === nats.REQ_TIMEOUT) {
        that.emit('timeout', msg);
      } else {
        that.emit('error', msg);
      }
      return;
    }
    //noinspection JSUnresolvedVariable
    var r = proto.SubscriptionResponse.deserializeBinary(Buffer.from(msg, 'binary').toByteArray());
    var err = r.getError();
    if (err && err.length !== 0) {
      retVal.emit('error', new Error(err));
      that.nc.unsubscribe(retVal.inboxSub);
      retVal.emit('unsubscribed');
      return;
    }
    retVal.ackInbox = r.getAckInbox();
    retVal.emit('ready');
  });

  return retVal;
};

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
function Subscription(stanConnection, subject, qGroup, inbox, opts) {
  this.stanConnection = stanConnection;
  this.subject = subject;
  this.qGroup = qGroup;
  this.inbox = inbox;
  this.opts = opts;
  this.ackInbox = undefined;
  this.inboxSub = undefined;
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

util.inherits(Subscription, events.EventEmitter);

/**
 * Returns true if the subscription has been closed or unsubscribed from.
 * @returns {boolean}
 */
Subscription.prototype.isClosed = function() {
  return this.stanConnection === undefined;
};

/**
 * Unregisters the subscription from the streaming server. You cannot unsubscribe
 * from the server unless the Subscription#ready notification has already fired.
 * @fires Subscription#error({Error}, Subscription#unsubscribed, Subscription#timeout({Error}
 */
Subscription.prototype.unsubscribe = function() {
  closeOrUnsubscribe(this, false);
};


/**
 * Close removes the subscriber from the server, but unlike the Subscription#unsubscribe(),
 * the durable interest is not removed. If the client has connected to a server
 * for which this feature is not available, Subscription#Close() will emit a
 * Subscription#error(NO_SERVER_SUPPORT) error. Note that this affects durable clients only.
 * If called on a non-durable subscriber, this is equivalent to Subscription#close()
 *
 * @fires Subscription#error({Error}, Subscription#closed
 */
Subscription.prototype.close = function() {
  closeOrUnsubscribe(this, true);
};


function closeOrUnsubscribe(that, doClose) {
  if(that.isClosed()) {
    that.emit('error', new Error(BAD_SUBSCRIPTION));
    return;
  }

  var sc = that.stanConnection;
  delete that.stanConnection;
  delete sc.subMap[that.inbox];

  if(sc.isClosed()) {
    that.emit('error', new Error(CONN_CLOSED));
    return;
  }

  var reqSubject = sc.unsubRequests;
  if(doClose) {
    reqSubject = sc.subCloseRequests;
    if(!reqSubject) {
      that.emit('error', new Error(NO_SERVER_SUPPORT));
    }
  }

  sc.nc.unsubscribe(that.inboxSub);
  //noinspection JSUnresolvedFunction
  var ur = new proto.UnsubscribeRequest();
  ur.setClientId(sc.clientID);
  ur.setSubject(that.subject);
  ur.setInbox(that.ackInbox);

  // fixme: hardcoded timeout
    sc.nc.requestOne(reqSubject, Buffer.from(ur.serializeBinary()), 2*1000, function (msg) {
      var err;
      if(msg instanceof nats.NatsError) {
          var type = doClose ? CLOSE_REQ_TIMEOUT : UNSUB_REQ_TIMEOUT;
          err = new nats.NatsError(type, type, msg);
          if(msg.code === nats.REQ_TIMEOUT) {
            that.emit('timeout', err);
          } else {
              that.emit('error', err);
          }
          return;
      }
    //noinspection JSUnresolvedVariable
    var r = proto.SubscriptionResponse.deserializeBinary(Buffer.from(msg, 'binary').toByteArray());
    err = r.getError();
    if(err && err.length > 0) {
      that.emit('error', new Error(r.getError()));
    } else {
      that.emit(doClose ? 'closed' : 'unsubscribed');
    }
  });

}


/**
 * Internal function to process in-bound messages.
 * @return {Function}
 * @private
 */
Stan.prototype.processMsg = function() {
  // curry
  var that = this;
  return function(rawMsg, reply, subject, sid) {
    var sub = that.subMap[subject];
    try {
      //noinspection JSUnresolvedVariable
      var m = proto.MsgProto.deserializeBinary(Buffer.from(rawMsg, 'binary').toByteArray());
      if (sub === undefined || !that.nc) {
        return;
      }
      var msg = new Message(that,  m, sub);
      sub.emit('message', msg);
      msg.maybeAutoAck();
    } catch (error) {
      sub.emit('error', error);
    }
  };
};

/**
 * Represents a message received from the streaming server.
 * @param stanClient
 * @param msg
 * @param subscription
 * @constructor
 */
function Message(stanClient, msg, subscription) {
  this.stanClient = stanClient;
  this.msg = msg;
  this.subscription = subscription;
}

/**
 * Returns the sequence number of the message.
 * @returns {number}
 */
Message.prototype.getSequence = function() {
  return this.msg.getSequence();
};

/**
 * Returns the subject the message was published on
 * @returns {string}
 */
Message.prototype.getSubject = function() {
  return this.msg.getSubject();
};

/**
 * Returns a Buffer object with the raw message payload.
 * @returns {Buffer}
 */
Message.prototype.getRawData = function() {
  return Buffer.from(this.msg.getData(), 'binary');
};

/**
 * Convenience API to convert the results of Message#getRawData to
 * a string with the specified 'stanEncoding'. Note that if the encoding
 * is set to binary, this method returns Message#getRawData.
 * @returns {!(string|Uint8Array)|string}
 */
Message.prototype.getData = function() {
  var bytes = this.msg.getData();
  var encoding = this.stanClient.options.stanEncoding;
  if(encoding !== 'binary') {
    bytes = bytes.length > 0 ? Buffer.from(bytes, encoding).toString() : '';
  }
  return bytes;
};

/**
 * Returns the raw timestamp. The NATS streaming server returns a 64bit nanosecond resolution
 * timestamp that is not quite useful in JavaScript. Use Message#getTimestamp to read
 * a timestamp as a Date.
 * @returns {number}
 */
Message.prototype.getTimestampRaw = function() {
  return this.msg.getTimestamp();
};

/**
 * Returns Message#getTimestampRaw as a JavaScript Date.
 * @returns {Date}
 */
Message.prototype.getTimestamp = function() {
  return new Date(this.getTimestampRaw()/1000000);
};

/**
 * Returns true if this message is being redelivered.
 * @returns {boolean}
 */
Message.prototype.isRedelivered = function() {
  return this.msg.getRedelivered();
};

/**
 * Returns the CRC32 of the message if provided.
 * @returns {number}
 */
Message.prototype.getCrc32= function() {
  return this.msg.getCrc32();
};

/**
 * Calls Message.ack if the subscription was specified to
 * use manualAcks.
 * @type {Message.ack}
 * @protected
 */
Message.prototype.maybeAutoAck = function() {
  if(! this.subscription.opts.manualAcks) {
    this.ack();
  }
};

/**
 * Acks the message, note this method shouldn't be called unless
 * the manualAcks option was set on the subscription.
 */
Message.prototype.ack = function() {
  if(!this.subscription.isClosed()) {
    var ack = new proto.Ack();
    ack.setSubject(this.getSubject());
    ack.setSequence(this.getSequence());
    this.stanClient.nc.publish(this.subscription.ackInbox, Buffer.from(ack.serializeBinary()));
  }
};


/**
 * Returns an object with various constants for StartPosition (NEW_ONLY,
 * LAST_RECEIVED, TIME_DELTA_START, SEQUENCE_START, FIRST)
 * @type {StartPosition}
 */
exports.StartPosition = proto.StartPosition;

function SubscriptionOptions(durableName, maxInFlight, ackWait, startPosition, startSequence, startTime, manualAcks) {
  // DurableName, if set will survive client restarts.
  this.durableName = durableName;
  // Controls the number of messages the cluster will have inflight without an ACK.
  this.maxInFlight = maxInFlight || DEFAULT_MAX_IN_FLIGHT;
  // Controls the time the cluster will wait for an ACK for a given message.
  this.ackWait = ackWait || DEFAULT_ACK_WAIT;
  // StartPosition enum from proto.
  this.startPosition = startPosition;
  // Optional start sequence number.
  this.startSequence = startSequence;
  // Optional start time.
  this.startTime = startTime;
  // Option to do Manual Acks
  this.manualAcks = manualAcks;
}

/**
 * Returns a SubscriptionOptions initialized to the defaults
 * @return {SubscriptionOptions}
 */
Stan.prototype.subscriptionOptions = function() {
  return new SubscriptionOptions();
};

/**
 * @param n
 * @returns {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setMaxInFlight = function(n) {
  this.maxInFlight = n;
  return this;
};

SubscriptionOptions.prototype.setAckWait = function(millis) {
  this.ackWait = millis;
  return this;
};

SubscriptionOptions.prototype.setStartAt = function(startPosition) {
  this.startPosition = startPosition;
  return this;
};

SubscriptionOptions.prototype.setStartAtSequence = function(sequence) {
  this.startPosition = proto.StartPosition.SEQUENCE_START;
  this.startSequence = sequence;
  return this;
};


/**
 * @param {Date} date
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setStartTime = function(date) {
  this.startPosition = proto.StartPosition.TIME_DELTA_START;
  // server expects values in ns
  this.startTime = (Date.now() - date.valueOf()) * 1000000;
  return this;
};

/**
 * @param {Number} millis
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setStartAtTimeDelta = function(millis) {
  this.startPosition = proto.StartPosition.TIME_DELTA_START;
  //noinspection JSUnresolvedFunction
  // server expects values in ns
  this.startTime =  millis * 1000000;
  return this;
};


/**
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setStartWithLastReceived = function() {
  this.startPosition = proto.StartPosition.LAST_RECEIVED;
  return this;
};


/**
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setDeliverAllAvailable = function() {
  this.startPosition = proto.StartPosition.FIRST;
  return this;
};


/**
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setManualAckMode = function(tf) {
  this.manualAcks = tf;
  return this;
};


/**
 * @param {String} durableName
 * @return {SubscriptionOptions}
 */
SubscriptionOptions.prototype.setDurableName = function(durableName) {
  this.durableName = durableName;
  return this;
};









