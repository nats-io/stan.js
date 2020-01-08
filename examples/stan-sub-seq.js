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

const args = process.argv.slice(2)
const clusterID = getFlagValue('-c') || 'test-cluster'
const clientID = getFlagValue('-id') || 'node-stan-sub'
const queueGroup = getFlagValue('-q') || ''
const server = getFlagValue('-s') || 'nats://localhost:4222'

const subject = args[0]
if (!subject) {
  usage()
}

function usage () {
  console.log('stan-sub [-c clusterId] [-id clientId] [-s server] [-q queueGroup] [-s server] <subject>')
  process.exit()
}

function getFlagValue (k) {
  const i = args.indexOf(k)
  if (i > -1) {
    const v = args[i + 1]
    args.splice(i, 2)
    return v
  }
}

const sc = STAN.connect(clusterID, clientID, server)
sc.on('connect', () => {
  console.log('STAN connected!')
  const opts = sc.subscriptionOptions()
  opts.setStartAtSequence(3)

  const subscription = sc.subscribe(subject, queueGroup, opts)
  subscription.on('error', function (err) {
    console.log(`subscription for ${subject} raised an error: ${err}`)
  })
  subscription.on('unsubscribed', function () {
    console.log(`unsubscribed to ${subject}`)
  })
  subscription.on('ready', () => {
    console.log(`subscribed to ${subject}`)
  })
  subscription.on('message', (msg) => {
    console.log(msg.getSubject(), `[${msg.getSequence()}]`, msg.getData())
  })
})

sc.on('error', (reason) => {
  console.log(reason)
})
