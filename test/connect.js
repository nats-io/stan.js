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

/* eslint-disable no-console */
/* global it: false, describe: false, beforeEach: false, afterEach: false */
'use strict'

const STAN = require('../lib/stan.js')
const nuid = require('nuid')
const ssc = require('./support/stan_server_control')
const should = require('should')
const timers = require('timers')
const os = require('os')
const path = require('path')

function latcher (count, done) {
  let c = count
  return () => {
    c--
    if (c === 0) {
      done()
    }
  }
}

describe('Connect', () => {
  const PORT = 9876
  const cluster = 'test-cluster'
  const uri = 'nats://localhost:' + PORT
  let server

  const serverDir = path.join(os.tmpdir(), nuid.next())

  function startServer (done) {
    server = ssc.start_server(PORT, ['--store', 'FILE', '--dir', serverDir], () => {
      timers.setTimeout(() => {
        done()
      }, 250)
    })
  }

  beforeEach((done) => {
    startServer(done)
  })

  // Shutdown our server after we are done
  afterEach((done) => {
    if (server) {
      server.kill()
    }
    done()
  })

  it('should perform basic connect with port', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), PORT)
    let connected = false
    sc.on('close', () => {
      connected.should.be.true()
      done()
    })
    sc.on('connect', () => {
      connected = true
      sc.close()
    })
  })

  it('should connect with port option', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), {
      port: PORT
    })
    let connected = false
    sc.on('close', () => {
      connected.should.be.true()
      done()
    })
    sc.on('connect', () => {
      connected = true
      sc.close()
    })
  })

  it('should perform basic connect with uri', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), uri)
    let connected = false
    sc.on('close', () => {
      connected.should.be.true()
      done()
    })
    sc.on('connect', () => {
      connected = true
      sc.close()
    })
  })

  it('should perform basic connect with options arg', (done) => {
    const options = {
      uri: uri
    }
    const sc = STAN.connect(cluster, nuid.next(), options)
    let connected = false
    sc.on('close', () => {
      connected.should.be.true()
      done()
    })
    sc.on('connect', () => {
      connected = true
      sc.close()
    })
  })

  it('should emit error if no server available', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), 'nats://localhost:22222')
    stan.on('error', () => {
      done()
    })
  })

  it('should emit connecting events and try repeatedly if configured and no server available', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), {
      uri: 'nats://localhost:22222',
      waitOnFirstConnect: true,
      reconnectTimeWait: 100,
      maxReconnectAttempts: 20
    })
    let connectingEvents = 0
    stan.on('error', (v) => {
      done(new Error('should not have produced error:' + v + ' reconnecting:' + connectingEvents))
    })
    stan.on('reconnecting', () => {
      connectingEvents++
    })
    setTimeout(() => {
      connectingEvents.should.be.within(4, 6)
      stan.close()
      done()
    }, 550)
  })

  function clusterTest (noRandomize, done) {
    const latch = latcher(2, done)

    const opts = {
      servers: ['nats://localhost:22222', uri, 'nats://localhost:22223']
    }

    if (noRandomize) {
      opts.noRandomize = true
    }

    const sca = STAN.connect(cluster, nuid.next(), opts)
    const scb = STAN.connect(cluster, nuid.next(), opts)
    const subject = nuid.next()

    sca.on('connect', () => {
      sca.publish(subject, 'bar', (err, guid) => {
        should.not.exist(err)
        should.exist(guid)
        sca.close()
      })
    })
    sca.on('close', latch)

    scb.on('connect', () => {
      const so = scb.subscriptionOptions()
      so.setStartAt(STAN.StartPosition.FIRST)
      const sub = scb.subscribe(subject, so)
      sub.on('error', (err) => {
        should.fail(err, null, 'Error handler was called: ' + err)
      })
      sub.on('message', (msg) => {
        msg.getSubject().should.equal(subject)
        msg.getData().should.equal('bar')
        sub.unsubscribe()
      })

      sub.on('unsubscribed', () => {
        scb.close()
      })
    })
    scb.on('close', latch)
  }

  it('should still receive publish when some servers are invalid', (done) => {
    clusterTest(false, done)
  })

  it('should still receive publish when some servers[noRandomize] are invalid', (done) => {
    clusterTest(true, done)
  })

  it('nats close, will attempt reconnects', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), {
      url: 'nats://localhost:' + PORT,
      reconnectTimeWait: 20,
      maxReconnectAttempts: 10
    })
    let disconnect = false
    sc.on('disconnect', () => {
      disconnect = true
    })

    let reconnecting = 0
    sc.on('reconnecting', () => {
      reconnecting++
    })

    sc.on('close', () => {
      disconnect.should.be.true()
      reconnecting.should.be.greaterThan(0)
      done()
    })
    sc.on('connect', () => {
      process.nextTick(() => {
        server.kill()
      })
    })
  }).timeout(15000)

  it('reconnect should provide stan connection', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), {
      url: 'nats://localhost:' + PORT,
      reconnectTimeWait: 1000,
      maxReconnectAttempts: 10
    })
    let reconnected = false
    sc.on('connect', (sc) => {
      should(sc).equal(sc, 'stan connect did not pass stan connection')
      process.nextTick(() => {
        ssc.stop_server(server)
      })
    })
    sc.on('reconnecting', () => {
      // should have emitted a disconnect
      if (!reconnected) {
        reconnected = true
        server = ssc.start_server(PORT, ['--store', 'FILE', '--dir', serverDir])
      }
    })
    sc.on('reconnect', (sc) => {
      should.exist(sc)
      sc.close()
      done()
    })
  }).timeout(15000)

  it('sub after disconnect raises timeout', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), {
      url: 'nats://localhost:' + PORT,
      reconnectTimeWait: 1000,
      maxReconnectAttempts: 5
    })

    sc.on('connect', () => {
      sc.on('timeout', () => {
        sc.close()
      })

      sc.on('close', () => {
        done()
      })

      sc.nc.on('disconnect', () => {
        sc.subscribe('are.you.there', () => {
          // ignore
        })
      })

      process.nextTick(() => {
        ssc.stop_server(server)
      })
    })
  }).timeout(10000)
})
