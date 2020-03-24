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

/* global it: false, describe: false, beforeEach: false, afterEach: false */
'use strict'

const STAN = require('../lib/stan')
const NATS = require('nats')
const proto = require('../lib/pb')
const ssc = require('./support/stan_server_control')
const nuid = require('nuid')
const should = require('should')
const timers = require('timers')

function latcher (count, done) {
  let c = count
  return function () {
    c--
    if (c === 0) {
      done()
    }
  }
}

describe('Basics', () => {
  const cluster = 'test-cluster'
  const PORT = 1423
  const uri = 'nats://localhost:' + PORT
  let server

  // Start up our own streaming
  beforeEach((done) => {
    server = ssc.start_server(PORT, () => {
      timers.setTimeout(done, 250)
    })
  })

  // Shutdown our server after we are done
  afterEach(() => {
    // noinspection JSUnresolvedFunction
    ssc.stop_server(server)
    server = undefined
  })

  it('should do basic subscribe and unsubscribe', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const so = stan.subscriptionOptions()
      so.setStartAt(STAN.StartPosition.FIRST)
      const sub = stan.subscribe('foo', so)
      sub.on('error', (err) => {
        should.fail(err, null, 'Error handler was called')
      })
      sub.on('ready', () => {
        sub.subject.should.be.equal('foo')
        should.not.exist(sub.qGroup)
        should.exist(sub.inbox)
        should.exist(sub.ackInbox)
        should.exist(sub.inboxSub)
        sub.unsubscribe()
      })
      sub.on('unsubscribed', () => {
        stan.close()
        done()
      })
    })
  })

  it('published messages should have connID and clientID', (done) => {
    done = latcher(2, done)
    const clientID = nuid.next()
    const stan = STAN.connect(cluster, clientID, PORT)
    stan.on('connect', () => {
      const connID = Buffer.from(stan.connId).toString('utf8')
      const nc = NATS.connect({
        encoding: 'binary',
        preserveBuffers: true,
        port: PORT
      })
      nc.on('connect', () => {
        nc.subscribe(stan.pubPrefix + '.hello', (msg) => {
          const pm = proto.pb.PubMsg.deserializeBinary(new Uint8Array(msg))
          const cid = pm.getClientId()
          clientID.should.be.equal(cid)
          const connid = Buffer.from(pm.getConnId()).toString('utf8')
          connID.should.be.equal(connid)
          nc.close()
          done()
        })
        nc.flush(() => {
          stan.publish('hello', 'world', (err) => {
            if (err) {
              should.fail(err)
            }
            stan.close()
            done()
          })
        })
      })
    })
  })

  it('subscription options should allow chaining', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const so = stan.subscriptionOptions()
      so.setStartAt(STAN.StartPosition.FIRST)
        .setMaxInFlight(100)
        .setAckWait(101)
        .setStartAt(102)
        .setStartAtSequence(103)
        .setStartTime(Date.now())
        .setStartAtTimeDelta(1000)
        .setStartWithLastReceived()
        .setDeliverAllAvailable()
        .setManualAckMode(true)
        .setDurableName('foo')

      stan.close()
      done()
    })
  })

  it('should do publish', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const sid = stan.publish('foo', 'bar', (err, guid) => {
        should.exist(guid)
        guid.should.be.equal(sid)
        should.not.exist(err)
        stan.close()
        done()
      })
    })
  })

  it('should do basic publish (only pub)', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const subject = nuid.next()
      stan.publish(subject, 'bzz', (err, guid) => {
        should.not.exist(err)
        should.exist(guid)
        stan.close()
        done()
      })
    })
  })

  it('should fire a callback for subscription', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const so = stan.subscriptionOptions()
      so.setStartAt(STAN.StartPosition.NEW_ONLY)
      const subject = nuid.next()
      const sub = stan.subscribe(subject, so)
      sub.on('ready', () => {
        stan.publish(subject, 'foo', (err, guid) => {
          should.not.exist(err)
          should.exist(guid)
        })
      })
      sub.on('unsubscribed', () => {
        stan.close()
        done()
      })
      sub.on('message', () => {
        sub.unsubscribe()
      })
    })
  })

  it('duplicate client id should fire error', (done) => {
    const latch = latcher(2, function () {
      stan.close()
      done()
    })
    const id = nuid.next()
    const stan = STAN.connect(cluster, id, PORT)
    stan.on('connect', () => {
      const stan2 = STAN.connect(cluster, id, PORT)
      stan2.on('error', () => {
        latch()
      })
      stan2.on('close', () => {
        latch()
      })
    })
  })

  it('should include the correct message in the callback', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const subject = nuid.next()
      const so = stan.subscriptionOptions()
      so.setStartAt(STAN.StartPosition.FIRST)
      const sub = stan.subscribe(subject, so)
      sub.on('message', (m) => {
        m.getSubject().should.be.equal(subject)
        sub.unsubscribe()
      })
      sub.on('unsubscribed', () => {
        stan.close()
        done()
      })
      stan.publish(subject)
    })
  })

  it('should include the correct reply in the callback', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)

    const latch = latcher(2, () => {
      stan.close()
      done()
    })

    stan.on('connect', () => {
      const subja = nuid.next()
      const subjb = nuid.next()

      const so = stan.subscriptionOptions()
      so.setStartAt(STAN.StartPosition.FIRST)
      const sub1 = stan.subscribe(subja, so)
      sub1.on('message', (m) => {
        m.getSubject().should.be.equal(subja)
        sub1.unsubscribe()
      })
      sub1.on('unsubscribed', latch)

      const sub2 = stan.subscribe(subjb, so)
      sub2.on('message', (m) => {
        m.getSubject().should.be.equal(subjb)
        sub2.unsubscribe()
      })
      sub2.on('unsubscribed', latch)

      stan.publish(subja)
      stan.publish(subjb)
    })
  })

  it('should error if unsubscribe after close of connection', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    let sub
    stan.on('connect', () => {
      sub = stan.subscribe(nuid.next())
      sub.on('ready', () => {
        stan.close()
      })
      sub.on('error', (e) => {
        e.message.should.containEql('Connection closed')
        done()
      })
    })

    stan.on('close', () => {
      sub.unsubscribe()
    })
  })

  it('should not receive data after unsubscribe call', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)

    stan.on('connect', () => {
      const req = nuid.next()

      const so = stan.subscriptionOptions()
      so.setStartAt(STAN.StartPosition.FIRST)
      // subscriber for request, replies on the specified subject
      const sub = stan.subscribe(req, so)
      sub.on('ready', () => {
        stan.publish(req, '')
        stan.publish(req, '')
        stan.publish(req, '')
      })

      let count = 0
      sub.on('message', () => {
        count++
        sub.unsubscribe()
      })

      sub.on('unsubscribed', () => {
        (count).should.be.equal(1)
        stan.close()
        done()
      })
    })
  })

  it('publish cb is error if not connected', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      stan.close()
    })
    stan.on('close', () => {
      stan.publish('foo', 'bar', (error) => {
        if (error instanceof Error) {
          done()
        }
      })
    })
  })

  it('publish throws error if not connected', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      stan.close()
    })
    stan.on('close', () => {
      try {
        stan.publish('foo', 'bar')
      } catch (error) {
        done()
      }
    })
  })

  it('maxPubAcksInflight should cb on error', (done) => {
    const opts = {
      maxPubAcksInflight: 3,
      uri: uri
    }
    const stan = STAN.connect(cluster, nuid.next(), opts)
    let failed = false
    stan.on('connect', () => {
      const cb = (err) => {
        if (failed) {
          return
        }
        if (err) {
          if (err.message === 'stan: max in flight reached.') {
            failed = true
            process.nextTick(() => {
              stan.close()
              done()
            })
          }
        }
      }

      for (let i = 0; i < 10; i++) {
        stan.publish(nuid.next(), 'bar', cb)
      }
    })
  })

  it('maxPubAcksInflight should toss on error', (done) => {
    const opts = {
      maxPubAcksInflight: 3,
      uri: uri
    }
    const stan = STAN.connect(cluster, nuid.next(), opts)
    const buf = Buffer.from('HelloWorld', 'utf8')
    let failed = false
    stan.on('connect', () => {
      for (let i = 0; i < 10; i++) {
        try {
          stan.publish(nuid.next(), buf)
        } catch (err) {
          if (!failed) {
            if (err.message === 'stan: max in flight reached.') {
              failed = true
              process.nextTick(() => {
                stan.close()
                done()
              })
            }
          }
        }
      }
    })
  })

  it('subscribe requires subject and emits error otherwise', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const sub = stan.subscribe(undefined)
      sub.on('error', (err) => {
        if (err.message === 'stan: subject must be supplied') {
          stan.close()
          done()
        }
      })
    })
  })

  it('subscribe requires a connection and emits error otherwise', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      stan.close()
    })
    stan.on('close', () => {
      const sub = stan.subscribe(nuid.next())
      sub.on('error', (err) => {
        if (err.message === 'stan: Connection closed') {
          done()
        }
      })
    })
  })

  it('subscribe emits timeout', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), {
      uri: uri,
      connectTimeout: 200
    })
    stan.on('connect', () => {
      server.kill()
      server = undefined

      const sub = stan.subscribe(nuid.next())
      sub.on('timeout', (err) => {
        if (err.message === 'stan: subscribe request timeout') {
          done()
        }
      })
    })
  })

  it('subscribe emits ready', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const sub = stan.subscribe(nuid.next())
      sub.on('ready', () => {
        sub.unsubscribe()
      })
      sub.on('unsubscribed', () => {
        stan.close()
        done()
      })
    })
  })

  it('unsubscribe twice is invalid', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const sub = stan.subscribe(nuid.next())
      sub.on('ready', () => {
        sub.unsubscribe()
      })
      sub.on('unsubscribed', () => {
        sub.unsubscribe()
      })
      sub.on('error', (err) => {
        if (err.message === 'stan: invalid subscription') {
          stan.close()
          done()
        }
      })
    })
  })

  it('unsubscribe marks it closed', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      const sub = stan.subscribe(nuid.next())
      sub.on('ready', () => {
        sub.unsubscribe()
        if (!sub.isClosed()) {
          done('Subscription should have been closed')
        }
      })
      sub.on('unsubscribed', () => {
        stan.close()
        done()
      })
    })
  })

  it('subscribe starting on second', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    const subj = nuid.next()
    let count = 0

    function subscribe () {
      let gotFirst = false
      const opts = stan.subscriptionOptions()
      opts.setStartAtSequence(2)
      const sub = stan.subscribe(subj, opts)
      sub.on('message', (msg) => {
        if (!gotFirst) {
          gotFirst = true
          should(msg.getData()).equal('second', 'second message was not the one expected')
          stan.close()
          done()
        }
      })
    }

    const waitForThree = () => {
      count++
      if (count === 3) {
        process.nextTick(subscribe)
      }
    }

    stan.on('connect', () => {
      stan.publish(subj, 'first', waitForThree)
      stan.publish(subj, 'second', waitForThree)
      stan.publish(subj, 'third', waitForThree)
    })
  })

  it('subscribe starting on last received', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    const subj = nuid.next()
    let count = 0

    function subscribe () {
      let gotFirst = false
      const opts = stan.subscriptionOptions()
      opts.setStartWithLastReceived()
      const sub = stan.subscribe(subj, opts)
      sub.on('message', (msg) => {
        if (!gotFirst) {
          gotFirst = true
          should(msg.getData()).equal('third', 'second message was not the one expected')
          stan.close()
          done()
        }
      })
    }

    const waitForThree = () => {
      count++
      if (count === 3) {
        process.nextTick(subscribe)
      }
    }

    stan.on('connect', () => {
      stan.publish(subj, 'first', waitForThree)
      stan.publish(subj, 'second', waitForThree)
      stan.publish(subj, 'third', waitForThree)
    })
  })

  it('subscribe after 500ms on last received', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    const subj = nuid.next()
    let count = 0

    function subscribe () {
      let gotFirst = false
      const opts = stan.subscriptionOptions()
      opts.setStartAtTimeDelta(1000)
      const sub = stan.subscribe(subj, opts)
      sub.on('message', (msg) => {
        if (!gotFirst) {
          gotFirst = true
          should(msg.getData()).equal('fourth', 'message was not the one expected')
          stan.close()
          done()
        }
      })
    }

    const waitForSix = () => {
      count++
      if (count === 6) {
        process.nextTick(subscribe)
      }
    }

    stan.on('connect', () => {
      stan.publish(subj, 'first', waitForSix)
      stan.publish(subj, 'second', waitForSix)
      stan.publish(subj, 'third', waitForSix)
      setTimeout(() => {
        stan.publish(subj, 'fourth', waitForSix)
        stan.publish(subj, 'fifth', waitForSix)
        stan.publish(subj, 'sixth', waitForSix)
      }, 1100)
    })
  }).timeout(5000)

  it('subscribe after a specific time on last received', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    const subj = nuid.next()
    let count = 0

    function subscribe () {
      let gotFirst = false
      const opts = stan.subscriptionOptions()
      opts.setStartTime(new Date(Date.now() - 1000))
      const sub = stan.subscribe(subj, opts)
      sub.on('message', (msg) => {
        if (!gotFirst) {
          gotFirst = true
          // node will be spurious since we are in a single thread
          const ok = msg.getData() === 'fourth' || msg.getData() === 'fifth' || msg.getData() === 'sixth'
          should(ok).equal(true, 'message was not the one expected')
          stan.close()
          done()
        }
      })
    }

    const waitForSix = () => {
      count++
      if (count === 6) {
        process.nextTick(subscribe)
      }
    }

    stan.on('connect', () => {
      stan.publish(subj, 'first', waitForSix)
      stan.publish(subj, 'second', waitForSix)
      stan.publish(subj, 'third', waitForSix)
      setTimeout(() => {
        stan.publish(subj, 'fourth', waitForSix)
        stan.publish(subj, 'fifth', waitForSix)
        stan.publish(subj, 'sixth', waitForSix)
      }, 1100)
    })
  }).timeout(5000)

  it('subscribe starting on new', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    const subj = nuid.next()
    let count = 0

    function subscribe () {
      let gotFirst = false
      const opts = stan.subscriptionOptions()
      opts.setStartAt(STAN.StartPosition.NEW_ONLY)
      const sub = stan.subscribe(subj, opts)
      sub.on('message', (msg) => {
        if (!gotFirst) {
          gotFirst = true
          msg.getData().should.be.equal('fourth')
          stan.close()
          done()
        }
      })

      sub.on('ready', () => {
        stan.publish(subj, 'fourth')
      })
    }

    const waitForThree = () => {
      count++
      if (count === 3) {
        process.nextTick(subscribe)
      }
    }

    stan.on('connect', () => {
      stan.publish(subj, 'first', waitForThree)
      stan.publish(subj, 'second', waitForThree)
      stan.publish(subj, 'third', waitForThree)
    })
  })

  it('subscribe all available', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    const subj = nuid.next()
    let count = 0

    function subscribe () {
      let gotFirst = false
      const opts = stan.subscriptionOptions()
      opts.setDeliverAllAvailable()
      const sub = stan.subscribe(subj, opts)
      sub.on('message', (msg) => {
        msg.getTimestamp().getTime().should.be.equal(parseInt(msg.getTimestampRaw() / 1000000, 10))
        msg.isRedelivered().should.be.equal(false)
        const buf = msg.getRawData()
        buf.length.should.be.greaterThan(0)

        if (!gotFirst) {
          gotFirst = true
          should(msg.getData()).equal('first', 'second message was not the one expected')
          stan.close()
          done()
        }
      })
    }

    const waitForThree = () => {
      count++
      if (count === 3) {
        process.nextTick(subscribe)
      }
    }

    stan.on('connect', () => {
      stan.publish(subj, 'first', waitForThree)
      stan.publish(subj, 'second', waitForThree)
      stan.publish(subj, 'third', waitForThree)
    })
  })

  it('queues should work', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    const subj = nuid.next()
    stan.on('connect', () => {
      let a = 0
      let b = 0

      // publish some events if we have 2 subscriptions
      const maybeStart = latcher(2, () => {
        for (let i = 0; i < 10; i++) {
          stan.publish(subj, i + '')
        }
      })

      // finish if we got 10 messages
      const maybeFinish = latcher(10, () => {
        (a + b).should.be.equal(10)
        a.should.be.greaterThan(0)
        b.should.be.greaterThan(0)
        stan.close()
        done()
      })

      const opts = stan.subscriptionOptions()
      opts.setDeliverAllAvailable()
      const suba = stan.subscribe(subj, 'queue', opts)
      const subb = stan.subscribe(subj, 'queue', opts)

      suba.on('message', () => {
        a++
        maybeFinish()
      })

      subb.on('message', () => {
        b++
        maybeFinish()
      })

      suba.on('ready', maybeStart)
      subb.on('ready', maybeStart)
    })
  })

  it('durables should work', (done) => {
    const clientID = nuid.next()
    const subj = nuid.next()

    const stan = STAN.connect(cluster, clientID, PORT)
    const opts = stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setManualAckMode(true)
    opts.setDurableName('my-durable')

    stan.on('connect', () => {
      const sub1 = stan.subscribe(subj, opts)
      sub1.on('ready', () => {
        for (let i = 0; i < 3; i++) {
          stan.publish(subj)
        }
      })

      sub1.on('message', (msg) => {
        const seq = msg.getSequence()
        if (seq < 3) {
          msg.ack()
        }
        if (seq === 2) {
          stan.close()
        }
      })
    })

    stan.on('close', () => {
      const stan2 = STAN.connect(cluster, clientID, PORT)
      stan2.on('connect', () => {
        const sub2 = stan2.subscribe(subj, opts)
        sub2.on('message', (msg) => {
          const seq = msg.getSequence()
          if (seq < 2) {
            should.fail("didn't expect to see sequences below 2")
          }
          seq.should.be.equal(3)
          stan2.close()
          done()
        })
      })
    })
  })

  it('sub close should stop getting messages', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), PORT)
    stan.on('connect', () => {
      // server needs to support close requests
      if (!stan.subCloseRequests || stan.subCloseRequests.length === 0) {
        stan.close()
        // skipped
        done()
        return
      }

      const subject = nuid.next()
      const opts = stan.subscriptionOptions()
      opts.setDeliverAllAvailable()
      const sub = stan.subscribe(subject, '', opts)
      let counter = 0
      sub.on('message', () => {
        counter++
        if (counter === 1) {
          sub.close()
        }
      })
      sub.on('ready', () => {
        stan.publish(subject)
      })
      sub.on('closed', () => {
        stan.publish(subject)
        stan.nc.flush(() => {
          counter.should.be.equal(1)
          stan.close()
          done()
        })
      })
    })
  })

  it('durables should work', (done) => {
    const clientID = nuid.next()
    const subj = nuid.next()

    const stan = STAN.connect(cluster, clientID, PORT)
    const opts = stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setManualAckMode(true)
    opts.setDurableName('my-durable')

    stan.on('connect', () => {
      const sub1 = stan.subscribe(subj, opts)
      sub1.on('ready', () => {
        for (let i = 0; i < 3; i++) {
          stan.publish(subj)
        }
      })

      sub1.on('message', (msg) => {
        const seq = msg.getSequence()
        if (seq < 3) {
          msg.ack()
        }
        if (seq === 2) {
          sub1.close()
        }
      })

      sub1.on('closed', () => {
        const sub2 = stan.subscribe(subj, opts)
        sub2.on('message', (msg) => {
          const seq = msg.getSequence()
          if (seq < 2) {
            should.fail("didn't expect to see sequences below 2")
          }
          seq.should.be.equal(3)
          stan.close()
          done()
        })
      })
    })
  })

  it('options should be passed', (done) => {
    // this test stuffs garbage value into options, it simply tests that
    // values are set on the client.
    const opts = { test_opts: true }
    const props = ['ackTimeout', 'connectTimeout', 'discoverPrefix', 'maxPubAcksInflight', 'nc',
      'maxReconnectAttempts', 'stanEncoding', 'stanMaxPingOut', 'stanPingInterval', 'encoding',
      'maxPingOut', 'maxReconnectAttempts', 'name', 'nkey', 'noRandomize', 'nonceSigner', 'pass',
      'pedantic', 'pingInterval', 'reconnect', 'reconnectTimeWait', 'servers', 'tls', 'token',
      'tokenHandler', 'url', 'useOldRequestStyle', 'user', 'userCreds', 'userJWT', 'verbose',
      'waitOnFirstConnect', 'yieldTime']

    props.forEach((v) => {
      opts[v] = nuid.next()
    })

    // the property 'test_opts' aborts after parse
    const sc = STAN.connect('c', 'id', opts)
    props.forEach((v) => {
      sc.options[v].should.be.equal(opts[v])
    })

    done()
  })

  it('versions should match', () => {
    const v = require('../package.json').version
    should.exist(STAN.version)
    v.should.be.equal(STAN.version)
  })

  it('redelivery count works', (done) => {
    const clientID = nuid.next()
    const subj = nuid.next()

    const stan = STAN.connect(cluster, clientID, PORT)
    const opts = stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setManualAckMode(true)
    opts.setDurableName('my-durable')

    let closeCount = 0
    function maybeClose () {
      closeCount++
      if (closeCount >= 2) {
        stan.close()
        done()
      }
    }

    function mh (sub) {
      return function (msg) {
        if (count === 0) {
          count++
          sub.close()
          return
        }
        msg.ack()
        msg.isRedelivered().should.be.true()
        msg.getRedeliveryCount().should.be.above(0)
        sub.close()
      }
    }

    let count = 0
    stan.on('connect', () => {
      const sub1 = stan.subscribe(subj, 'q', opts)
      const sub2 = stan.subscribe(subj, 'q', opts)

      sub2.on('ready', () => {
        stan.publish(subj)
      })

      sub1.on('message', mh(sub1))
      sub1.on('closed', maybeClose)
      sub2.on('message', mh(sub2))
      sub2.on('closed', maybeClose)
    })
  })
})
