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
const NATS = require('nats')
const nuid = require('nuid')
const ssc = require('./support/stan_server_control')
const should = require('should')
const timers = require('timers')

describe('Stan Connect', () => {
  const PORT = 9876
  const cluster = 'test-cluster'
  const uri = 'nats://localhost:' + PORT
  let server

  beforeEach((done) => {
    server = ssc.start_server(PORT, () => {
      timers.setTimeout(() => {
        done()
      }, 250)
    })
  })

  // Shutdown our server after we are done
  afterEach(() => {
    server.kill()
  })

  it('connect with hostport', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), 'localhost:' + PORT)
    sc.on('connect', () => {
      sc.close()
      done()
    })
  })

  it('Protocol subjects should have data', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), PORT)
    sc.on('connect', () => {
      should.exist(sc.pubPrefix)
      should.exist(sc.subRequests)
      should.exist(sc.unsubRequests)
      should.exist(sc.subCloseRequests)
      should.exist(sc.closeRequests)

      sc.close()
      done()
    })
  })

  it('should fail without a clusterId', (done) => {
    try {
      STAN.connect(undefined, nuid.next(), PORT)
    } catch (error) {
      should.exist(error)
      done()
    }
  })

  it('should fail without a clientId', (done) => {
    try {
      STAN.connect(cluster, undefined, PORT)
    } catch (error) {
      should.exist(error)
      done()
    }
  })

  it('default connection should have a NATS url', (done) => {
    const sc = STAN.connect(cluster, nuid.next())
    sc.on('error', () => {
      // test server is running in a diff port, so this will fail,
      // but the options should have default value
      should.exist(sc.options.url)
      sc.options.url.should.be.equal('nats://localhost:4222')
      done()
    })
  })

  it('use binary nats connection should work', (done) => {
    const nc = NATS.connect({
      uri: uri,
      encoding: 'binary'
    })
    const opts = {
      nc: nc
    }
    const stan = STAN.connect(cluster, nuid.next(), opts)
    stan.on('connect', () => {
      stan.close()
      nc.close()
      done()
    })
  })

  it('non-binary nats connection should fail', (done) => {
    const nc = NATS.connect({
      uri: uri,
      encoding: 'utf8'
    })
    const opts = {
      nc: nc
    }
    try {
      STAN.connect(cluster, nuid.next(), opts)
    } catch (err) {
      err.message.should.match((/stan: NATS connection encoding must be 'binary'./))
      nc.close()
      done()
    }
  })

  it('non-binary encoding connection should fail', (done) => {
    try {
      const opts = {
        encoding: 'utf8'
      }
      STAN.connect(cluster, nuid.next(), opts)
    } catch (err) {
      err.message.should.match((/stan: NATS connection encoding must be 'binary'./))
      done()
    }
  })

  it('should emit close', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), PORT)
    sc.on('connect', () => {
      sc.close()
    })
    sc.on('close', (err) => {
      should.not.exist(err)
      done()
    })
  })

  it('should ignore multi close', (done) => {
    const sc = STAN.connect(cluster, nuid.next(), PORT)
    sc.on('connect', () => {
      sc.close()
    })
    sc.on('close', () => {
      sc.close()
      done()
    })
  })

  it('closing nats should emit close', function (done) {
    const nc = NATS.connect({
      port: PORT,
      encoding: 'binary',
      reconnectTimeWait: 100,
      maxReconnectAttempts: 5
    })
    const opts = {
      nc: nc
    }
    const sc = STAN.connect(cluster, nuid.next(), opts)
    sc.on('connect', function () {
      server.kill()
    })
    sc.on('close', () => {
      done()
    })
  })
})
