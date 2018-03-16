/*
 * Copyright 2013-2018 The NATS Authors
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
/* global describe: false, before: false, after: false, it: false */
'use strict';

var STAN = require ('../lib/stan.js'),
    nuid = require('nuid'),
    ssc = require('./support/stan_server_control'),
    should = require('should'),
    timers = require('timers'),
    os = require('os'),
    path = require('path');

describe('Basic Connectivity', function() {

  var PORT = 9876;
  var cluster = 'test-cluster';
  var uri = 'nats://localhost:' + PORT;
  var server;

  var serverDir = path.join(os.tmpdir(), nuid.next());

  function startServer(done) {
    server = ssc.start_server(PORT, ['--store', 'FILE', '--dir', serverDir], function() {
      timers.setTimeout(function() {
        done();
      }, 250);
    });
  }

  before(function(done) {
    startServer(done);
  });

  // Shutdown our server after we are done
  after(function(){
    server.kill();
  });


  it('should perform basic connect with port', function(done){
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    var connected = false;
    stan.on('close', function() {
      connected.should.equal(true);
      done();
    });
    stan.on('connect', function() {
      connected = true;
      stan.close();
    });
  });

  it('on connect inbox should be set', function(done){
      var stan = STAN.connect(cluster, nuid.next(), PORT);
      stan.on('connect', function() {
        stan.pubPrefix.should.be.ok();
        stan.subRequests.should.be.ok();
        stan.unsubRequests.should.be.ok();
        stan.subCloseRequests.should.be.ok();
        stan.closeRequests.should.be.ok();

        stan.close();
        done();
      });
  });

  it('should perform basic connect with uri', function(done){
    var stan = STAN.connect(cluster, nuid.next(), uri);
   var connected = false;
    stan.on('close', function() {
      connected.should.be.equal(true);
      done();
    });
    stan.on('connect', function() {
      connected = true;
      stan.close();
    });
  });



  it('should perform basic connect with options arg', function(done){
    var options = { 'uri' : uri };
    var stan = STAN.connect(cluster, nuid.next(), options);
    var connected = false;
    stan.on('close', function() {
      connected.should.equal(true);
      done();
    });
    stan.on('connect', function() {
      connected = true;
      stan.close();
    });
  });


  it('should emit error if no server available', function(done){
    var stan = STAN.connect(cluster, nuid.next(), 'nats://localhost:22222');
    stan.on('error', function() {
      done();
    });
  });


  it('should emit connecting events and try repeatedly if configured and no server available', function(done){
    var stan = STAN.connect(cluster, nuid.next(), {'uri':'nats://localhost:22222',
			   'waitOnFirstConnect': true,
			   'reconnectTimeWait':100,
			   'maxReconnectAttempts':20});
    var connectingEvents = 0;
    stan.on('error', function(v) {
      done('should not have produced error:' + v + " reconnencting:" + connectingEvents);
    });
    stan.on('reconnecting', function() {
      connectingEvents++;
    });
    setTimeout(function(){
      should(connectingEvents).equal(5);
      done();
    }, 550);
  });


  it('should still receive publish when some servers are invalid', function(done){
    var natsServers = ['nats://localhost:22222', uri, 'nats://localhost:22223'];
    var ua = STAN.connect(cluster, nuid.next(), {servers: natsServers});
    var ub = STAN.connect(cluster, nuid.next(), {servers: natsServers});
    var subject = nuid.next();

    var uaClosed = false;
    var ubClosed = false;

    ua.on('connect', function() {
      ua.publish(subject, 'bar', function(err, guid) {
        should.not.exist(err);
        should.exist(guid);
        ua.close();
      });
    });
    ua.on('close', function() {
      uaClosed = true;
      if(ubClosed) {
        allCompleted();
      }
    });

    ub.on('connect', function () {
      var so = ub.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.FIRST);
      var sub = ub.subscribe(subject, so);
      sub.on('error', function (err) {
        should.fail(err, null, 'Error handler was called: ' + err);
      });
      sub.on('message', function(msg) {
        msg.getSubject().should.equal(subject);
        msg.getData().should.equal('bar');
        sub.unsubscribe();
      });

      sub.on('unsubscribed', function () {
        ub.close();
      });
    });
    ub.on('close', function(){
      ubClosed = true;
      if(uaClosed) {
        allCompleted();
      }
    });

    function allCompleted() {
      should(uaClosed).equal(true, 'ua didnt close');
      should(ubClosed).equal(true, 'ub didnt close');
      done();
    }
  });


  it('should still receive publish when some servers[noRandomize] are invalid', function(done) {
    var natsServers = ['nats://localhost:22222', uri, 'nats://localhost:22223'];
    var ua = STAN.connect(cluster, nuid.next(), {servers: natsServers, noRandomize: true});
    var ub = STAN.connect(cluster, nuid.next(), {servers: natsServers, noRandomize: true});
    var subject = nuid.next();

    var uaClosed = false;
    var ubClosed = false;

    ua.on('connect', function () {
      ua.publish(subject, 'bar', function (err, guid) {
        should.not.exist(err);
        should.exist(guid);
        ua.close();
      });
    });
    ua.on('close', function () {
      uaClosed = true;
      if (ubClosed) {
        allCompleted();
      }
    });

    ub.on('connect', function () {
      var so = ub.subscriptionOptions();
      so.setStartAt(STAN.StartPosition.FIRST);
      var sub = ub.subscribe(subject, so);
      sub.on('error', function (err) {
        should.fail(err, null, 'Error handler was called: ' + err);
      });
      sub.on('message', function (msg) {
        should(msg.getSubject()).equal(msg.getSubject(), 'subject did not match');
        should(msg.getData()).equal('bar', 'payload did not match');
        sub.unsubscribe();
      });

      sub.on('unsubscribed', function () {
        ub.close();
      });
    });
    ub.on('close', function () {
      ubClosed = true;
      if (uaClosed) {
        allCompleted();
      }
    });
    function allCompleted() {
      (uaClosed).should.equal(true, 'ua didnt close');
      (ubClosed).should.equal(true, 'ub didnt close');
      done();
    }
  });


  it('should add a new cluster server', function(done){
    var servers = [uri,'nats://localhost:22223'];
    var sc = STAN.connect(cluster, nuid.next(), {servers: new Array(servers[0])});
    var contains = 0;

    sc.on('connect', function(client) {
      client.nc.addServer(servers[1]);
      client.nc.servers.forEach(function(_server) {
       if (servers.indexOf(_server.url.href) !== -1) {
         contains++;
       }
      });
      should(contains).equal(servers.length);
      done();
    });
  });


  it('reconnect should provide stan connection', function (done) {
    // done = DoneSilencer(done);
    this.timeout(15000);
    var stan = STAN.connect(cluster, nuid.next(), {'url':'nats://localhost:' + PORT, 'reconnectTimeWait':1000});
    var reconnected = false;
    stan.on('connect', function (sc) {
      should(stan).equal(sc, 'stan connect did not pass stan connection');
      process.nextTick(function () {
        ssc.stop_server(server);
      });
    });
    stan.on('reconnecting', function () {
      if (!reconnected) {
        reconnected = true;
        server = ssc.start_server(PORT, ['--store', 'FILE', '--dir', serverDir], function () {
        });
      }
    });
    stan.on('reconnect', function (sc) {
      should(stan).equal(sc, 'stan reconnect did not pass stan connection');
        stan.close();
        done();
    });
  });

  it('nats close, should not close stan', function (done) {
    this.timeout(15000);
    var stan = STAN.connect(cluster, nuid.next(), {'url':'nats://localhost:' + PORT, 'reconnectTimeWait':20});
    stan.on('close', function() {
      (stan.nc.connected).should.equal(false, "nc should be closed");
      (stan.isClosed()).should.equal(false, "sc should not be closed");
      startServer(done);
    });
    stan.on('connect', function (sc) {
      should(stan).equal(sc, 'stan connect did not pass stan connection');
      process.nextTick(function() {
        server.kill();
      });
    });
  });

  it('sub after disconnect raises error', function (done) {
    this.timeout(10000);
    var stan = STAN.connect(cluster, nuid.next(), {'url': 'nats://localhost:' + PORT, 'reconnectTimeWait': 1000});
    stan.on('connect', function () {
      setTimeout(function () {
        stan.subscribe("are.you.there", function (m) {});
      }, 250);
      setTimeout(function () {
        ssc.stop_server(server);
      }, 0);
    });

    stan.on('timeout', function (err) {
      // restart the server for others
      startServer(done);
    });
  });
});