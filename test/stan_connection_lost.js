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

/* jslint node: true */
/* global describe: false, beforeEach: false, afterEach: false, it: false */
'use strict';

var STAN = require ('../lib/stan.js'),
NATS = require('nats'),
nuid = require('nuid'),
ssc = require('./support/stan_server_control'),
should = require('should'),
timers = require('timers');

describe('Stan Server Ping Specific', function() {

  var PORT = 9876;
  var cluster = 'test-cluster';
  var uri = 'nats://localhost:' + PORT;
  var server = null;

  beforeEach(function (done) {
    server = ssc.start_server(PORT, function () {
      timers.setTimeout(function () {
        done();
      }, 250);
    });
  });

  // Shutdown our server after we are done
  afterEach(function (done) {
    if (server) {
      server.kill();
      server = null;
      timers.setTimeout(function () {
        done();
      }, 250);
    } else {
      done();
    }
  });


  it('Should get a "connection_lost" event if the server goes away', function (done) {
    this.timeout(5000);
    var t1, t2;
    var stan = STAN.connect(cluster, nuid.next(), {
      url: uri,
      pingInterval: 1000,
      pingMaxOut: 2
    });
    stan.on('connection_lost', function () {
      t2 = new Date().getTime();
      stan.close();

      var duration = t2 - t1;
      duration.should.be.greaterThanOrEqual((stan.pingMaxOut + 1) * stan.pingInterval);
      duration.should.be.lessThanOrEqual((stan.pingMaxOut + 2) * stan.pingInterval);
      done();
    });
    stan.on('connect', function () {
      t1 = new Date().getTime();
      server.kill();
      server = null;
    });
  });

  it('Should get a "connection_lost" event if the server cycles and looses state', function (done) {
    this.timeout(5000);
    var connected = false;
    var disconnected = false;
    var reconnecting = false;
    var reconnected = false;
    var stan = STAN.connect(cluster, nuid.next(), {
      url: uri,
      pingInterval: 1000,
      pingMaxOut: 4
    });
    stan.on('connection_lost', function () {
      stan.close();

      should.equal(connected, true);
      should.equal(disconnected, true);
      should.equal(reconnecting, true);
      should.equal(reconnected, true);

      done();
    });
    stan.on('connect', function () {
      server.kill();
      server = null;
      timers.setTimeout(function () {
        server = ssc.start_server(PORT);
      }, 250);

      connected = true;
    });
    stan.on('disconnect', function () {
      disconnected = true;
    });
    stan.on('reconnecting', function () {
      reconnecting = true;
    });
    stan.on('reconnect', function () {
      reconnected = true;
    });
  });

});
