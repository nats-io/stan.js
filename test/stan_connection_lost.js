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

describe('Stan Connection Lost', () => {
  const PORT = 9876
  const NATS_A = 6789
  const NATS_A_CLUSTER = 6790
  const NATS_B = 6791
  const NATS_B_CLUSTER = 6792

  const cluster = 'test-cluster'
  const uri = 'nats://localhost:' + NATS_A
  let stanSrv = null
  let natsA = null
  let natsB = null

  beforeEach((done) => {
    natsA = ssc.start_server(NATS_A, ['-cid', 'not-test-cluster', '--cluster', 'nats://localhost:' + NATS_A_CLUSTER], () => {
      natsB = ssc.start_server(NATS_B, ['-cid', 'not-test-cluster2', '--cluster', 'nats://localhost:' + NATS_B_CLUSTER, '--routes', 'nats://localhost:' + NATS_A_CLUSTER], () => {
        stanSrv = ssc.start_server(PORT, ['-ns', 'nats://localhost:' + NATS_A], () => {
          timers.setTimeout(() => {
            done()
          }, 250)
        })
      })
    })
  })

  // Shutdown our server after we are done
  afterEach((done) => {
    if (stanSrv) {
      stanSrv.kill()
    }
    if (natsA) {
      natsA.kill()
    }
    if (natsB) {
      natsB.kill()
    }
    setTimeout(done, 250)
  })

  it('should get a "connection_lost" event if the server goes away', (done) => {
    let t1, t2
    const sc = STAN.connect(cluster, nuid.next(), {
      url: uri,
      stanPingInterval: 1000,
      stanMaxPingOut: 2
    })
    sc.on('error', (err) => {
      console.log('ignoring', err)
    })
    sc.on('connection_lost', () => {
      t2 = new Date().getTime()
      const duration = t2 - t1
      duration.should.be.greaterThanOrEqual((sc.stanMaxPingOut + 1) * sc.stanPingInterval)
      duration.should.be.lessThanOrEqual((sc.stanMaxPingOut + 2) * sc.stanPingInterval)
      done()
    })
    sc.on('connect', () => {
      t1 = new Date().getTime()
      stanSrv.kill()
      stanSrv = null
    })
  }).timeout(10000)

  it('should get a "connection_lost" event if the server cycles and looses state', (done) => {
    const stan = STAN.connect(cluster, nuid.next(), {
      url: uri,
      stanPingInterval: 1000,
      stanMaxPingOut: 3
    })
    stan.on('connection_lost', () => {
      done()
    })
    stan.on('connect', () => {
      stanSrv.kill()
      stanSrv = null
      timers.setTimeout(() => {
        stanSrv = ssc.start_server(PORT)
      }, 250)
    })
  }).timeout(10000)

  it('should get a "connection_lost" when replaced', (done) => {
    const id = nuid.next()

    function connectClient (url, name) {
      const sc = STAN.connect(cluster, id, {
        url: url,
        stanPingInterval: 1000,
        stanMaxPingOut: 10,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 1000,
        waitOnFirstConnect: true,
        name: name
      })

      // blank out the server updates, we want the client
      // to only connect to the given server while allowing
      // stan to know about cluster topology
      sc.processServerUpdate = () => {
        // overwrite process server update
        // to do nothing
      }

      sc.on('connect', () => {
        // console.log(sc.nc.options.name, 'connected', sc.nc.servers[0].toString());
        const count = sc.nc.servers.length
        if (count > 1) {
          sc.nc.servers.splice(1, count - 1)
        }
      })

      sc.on('disconnect', () => {
        // console.log(sc.nc.options.name, "disconnect");
      })

      sc.on('reconnected', () => {
        // console.log(sc.nc.options.name, "reconnect", sc.nc.servers[0].toString());
      })

      sc.on('connection_lost', (err) => {
        const name = sc.nc.options.name
        // console.log(name, "connection_lost", sc.nc.servers[0].toString(), err);
        name.should.be.equal('sc1')
        should(gotAckError).be.true()
        err.message.should.be.equal('client has been replaced or is no longer registered')
        if (sc2 !== null) {
          sc2.close()
        }
        done()
      })

      return sc
    }

    const sc1 = connectClient('nats://localhost:' + NATS_A, 'sc1')
    let sc2 = null
    let gotAckError = false

    sc1.on('connect', () => {
      setTimeout(() => {
        natsA.kill()
        sc1.publish('hello', 'world', (err) => {
          err.message.should.be.equal('client has been replaced or is no longer registered')
          gotAckError = true
        })
      }, 1000)
    })
    sc1.on('disconnect', () => {
      if (!sc2) {
        sc2 = connectClient('nats://localhost:' + NATS_B, 'sc2')
        sc2.on('connect', () => {
          natsA = ssc.start_server(NATS_A, ['-cid', 'not-test-cluster', '--cluster', 'nats://localhost:' + NATS_A_CLUSTER])
        })
      }
    })
  }).timeout(10000)
})
