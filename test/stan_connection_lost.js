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
  var NATS_A = 6789;
  var NATS_A_CLUSTER = 6790;
  var NATS_B = 6791;
  var NATS_B_CLUSTER = 6792;

  var cluster = 'test-cluster';
  var uri = 'nats://localhost:' + NATS_A;
  var stan_server = null;
  var natsA = null;
  var natsB = null;

  beforeEach(function (done) {
    natsA = ssc.start_server(NATS_A, ['-cid', 'not-test-cluster', '--cluster', 'nats://localhost:' + NATS_A_CLUSTER], function () {
      natsB = ssc.start_server(NATS_B, ['-cid', 'not-test-cluster2', '--cluster', 'nats://localhost:' + NATS_B_CLUSTER, '--routes', 'nats://localhost:' + NATS_A_CLUSTER], function() {
        stan_server = ssc.start_server(PORT, ['-ns', 'nats://localhost:' + NATS_A], function () {
          timers.setTimeout(function () {
            done();
          }, 250);
        });
      });
    });
  });

  // Shutdown our server after we are done
  afterEach(function (done) {
    if (stan_server) {
      stan_server.kill();
    }
    if (natsA) {
      natsA.kill();
    }
    if (natsB) {
      natsB.kill();
    }
    setTimeout(done, 250);
  });


  it('should get a "connection_lost" event if the server goes away', function (done) {
    this.timeout(10000);
    var t1, t2;
    var stan = STAN.connect(cluster, nuid.next(), {
      url: uri,
      pingInterval: 1000,
      pingMaxOut: 2
    });
    stan.on('error', function(err) {
      console.log('ignoring', err);
    });
    stan.on('connection_lost', function () {
      t2 = new Date().getTime();
      var duration = t2 - t1;
      duration.should.be.greaterThanOrEqual((stan.pingMaxOut + 1) * stan.pingInterval);
      duration.should.be.lessThanOrEqual((stan.pingMaxOut + 2) * stan.pingInterval);
      done();
    });
    stan.on('connect', function () {
      t1 = new Date().getTime();
      stan_server.kill();
      stan_server = null;
    });
  });

  it('should get a "connection_lost" event if the server cycles and looses state', function (done) {
    this.timeout(10000);
    var connected = false;
    var disconnected = false;
    var reconnecting = false;
    var reconnected = false;
    var stan = STAN.connect(cluster, nuid.next(), {
      url: uri,
      pingInterval: 1000,
      pingMaxOut: 3
    });
    stan.on('connection_lost', function () {
      done();
    });
    stan.on('connect', function () {
      stan_server.kill();
      stan_server = null;
      timers.setTimeout(function () {
        stan_server = ssc.start_server(PORT);
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

  it('should get a "connection_lost" when replaced', function(done) {
    this.timeout(10000);
    var id = nuid.next();
    function connectClient(url, name) {
      var sc = STAN.connect(cluster, id, {
        url: url,
        pingInterval: 1000,
        pingMaxOut: 10,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 1000,
        waitOnFirstConnect: true,
        name: name
      });

      // blank out the server updates, we want the client
      // to only connect to the given server while allowing
      // stan to know about cluster topology
      sc.processServerUpdate = function(){};

      sc.on('connect', function() {
        // console.log(sc.nc.options.name, 'connected', sc.nc.servers[0].toString());
        var count = sc.nc.servers.length;
        if(count > 1) {
          sc.nc.servers.splice(1, count-1);
        }
      });

      sc.on('disconnect', function() {
        // console.log(sc.nc.options.name, "disconnect");
      });

      sc.on('reconnected', function() {
        // console.log(sc.nc.options.name, "reconnect", sc.nc.servers[0].toString());
      });

      sc.on('connection_lost', function(err) {
        var name = sc.nc.options.name;
        // console.log(name, "connection_lost", sc.nc.servers[0].toString(), err);
        name.should.be.equal("sc1");
        should(gotAckError).be.true();
        err.should.be.equal("client has been replaced or is no longer registered");
        if(sc2 != null) {
          sc2.close();
        }
        done();
      });

      return sc;
    }

    var sc1 = connectClient("nats://localhost:" + NATS_A, "sc1");
    var sc2 = null;
    var gotAckError = false;

    sc1.on('connect', function () {
      setTimeout(function() {
        natsA.kill();
        sc1.publish("hello", "world", function (err) {
          err.should.be.equal("client has been replaced or is no longer registered");
          gotAckError = true;
        });
      }, 1000);
    });
    sc1.on('disconnect', function () {
      if(!sc2) {
        sc2 = connectClient("nats://localhost:" + NATS_B, "sc2");
        sc2.on('connect', function() {
          natsA = ssc.start_server(NATS_A, ['-cid', 'not-test-cluster', '--cluster', 'nats://localhost:' + NATS_A_CLUSTER]);
        });
      }
    });
  });
});
