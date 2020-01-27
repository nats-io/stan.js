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
const clientID = argv.i || 'node-stan-pub'
const server = argv.s || 'nats://localhost:4222'
const queueGroup = argv.q || ''
const subject = argv._[0]

if (!subject) {
  usage()
}

function usage () {
  console.log('stan-sub [-c clusterId] [-i clientId] [-s server] [-q queueGroup] <subject>')
  process.exit()
}

const stan = STAN.connect(clusterID, clientID, server)
stan.on('connect', function () {
  console.log('STAN connected!')
  const opts = stan.subscriptionOptions()
  opts.setStartWithLastReceived()

  const subscription = stan.subscribe(subject, queueGroup, opts)
  subscription.on('error', (err) => {
    console.log(`subscription for ${subject} raised an error: ${err}`)
  })
  subscription.on('unsubscribed', () => {
    console.log(`unsubscribed to ${subject}`)
  })
  subscription.on('ready', (sub) => {
    console.log(`subscribed to ${sub.subject}`)
  })
  subscription.on('message', (msg) => {
    console.log(msg.getSubject(), `[${msg.getSequence()}]`, msg.getData())
  })
})

stan.on('error', function (reason) {
  console.log(reason)
})
