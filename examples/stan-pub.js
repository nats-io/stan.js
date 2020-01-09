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
const subject = argv._[0]
const body = argv._[1] || ''

if (!subject) {
  usage()
}

function usage () {
  console.log('stan-pub [-c clusterId] [-i clientId] [-s server] <subject> [msg]')
  process.exit()
}

const sc = STAN.connect(clusterID, clientID, server)
sc.on('connect', () => {
  sc.publish(subject, body, (err, guid) => {
    if (err) {
      console.log(err)
      process.exit(1)
    } else {
      console.log(`published ${subject} (${guid})`)
    }
    sc.close()
  })
})

sc.on('error', function (reason) {
  console.log(reason)
})
