#!/usr/bin/env node

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

/* eslint-disable no-console, no-process-exit */

'use strict'

const STAN = require('../lib/stan.js')

const argv = require('minimist')(process.argv.slice(2))
const clusterID = argv.c || 'test-cluster'
const clientID = argv.i || 'bench-pub'
const server = argv.s || 'nats://localhost:4222'
const qGroup = argv.g || ''
let count = argv.m || 100000
count = parseInt(count, 10)
const subject = argv._[0]

if (!subject) {
  usage()
}

function usage () {
  console.log('bench-sub [-c clusterId] [-i clientId] [-s server] [-m messageCount] [-q qGroup] <subject>')
  process.exit()
}

const stan = STAN.connect(clusterID, clientID, {
  url: server
})

let start
stan.on('connect', () => {
  start = Date.now()
  const opts = stan.subscriptionOptions()
  opts.setDeliverAllAvailable()
  if (qGroup) {
    opts.setQGroup(qGroup)
  }
  const sub = stan.subscribe(subject, opts)
  sub.on('error', (err) => {
    console.log('subscription for ' + sub.subject + ' raised an error: ' + err)
  })
  sub.on('unsubscribed', () => {
    stan.close()
  })
  sub.on('ready', () => {
    console.log('subscribed to', sub.subject, sub.qGroup ? 'qGroup ' + qGroup : '')
  })

  let received = 0

  sub.on('message', () => {
    received++
    if (received === count) {
      const end = Date.now()
      const time = end - start
      stan.nc.flush(() => {
        const msgPerSec = Math.round(count / (time / 1000))
        console.log(`\nReceived ${count} msgs in ${time}ms (${msgPerSec} msgs/sec)`)
        sub.unsubscribe()
      })
    }
  })
})

stan.on('close', function () {
  process.exit(0)
})
