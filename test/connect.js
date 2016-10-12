/* jslint node: true */
/* global describe: false, before: false, after: false, it: false */
'use strict';

var STAN = require ('../lib/stan.js'),
    nuid = require('../lib/nuid'),
    ssc = require('./support/stan_server_control'),
    should = require('should'),
    timers = require('timers');

describe('Basic Connectivity', function() {

  var PORT = 9876;
  var cluster = 'test-cluster';
  var uri = 'nats://localhost:' + PORT;
  var server;

  before(function(done) {
    server = ssc.start_server(PORT, function() {
      timers.setTimeout(function() {
        done();
      }, 250);
    });
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
});