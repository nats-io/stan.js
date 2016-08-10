/* jslint node: true */
/* global describe: false, before: false, after: false, it: false */
'use strict';

var STAN = require ('../lib/stan.js'),
NATS = require('nats'),
nuid = require('../lib/nuid.js'),
ssc = require('./support/stan_server_control'),
should = require('should'),
timers = require('timers');

describe('Stan Connection Specific', function() {

  var PORT = 9876;
  var cluster = 'test-cluster';
  var uri = 'nats://localhost:' + PORT;
  var server;

  before(function (done) {
    server = ssc.start_server(PORT, function () {
      timers.setTimeout(function () {
        done();
      }, 250);
    });
  });

  // Shutdown our server after we are done
  after(function () {
    server.kill();
  });


  it('Protocol subjects should have data', function (done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function () {
      should(stan.pubPrefix).not.have.length(0);
      should(stan.subRequests).not.have.length(0);
      should(stan.unsubRequests).not.have.length(0);
      should(stan.closeRequests).not.have.length(0);
      stan.close();
      done();
    });
  });


  it('should fail without a clusterId', function(done) {
    try {
      STAN.connect(undefined, nuid.next(), PORT);
    } catch(error) {
      if(error) {
        done();
      }
    }
  });

  it('should fail without a clientId', function(done) {
    try {
      STAN.connect(cluster, undefined, PORT);
    } catch(error) {
      if(error) {
        done();
      }
    }
  });

  it('default connection should have a NATS url', function(done) {
    var stan = STAN.connect(cluster, nuid.next());
    stan.on('error', function(error){
      // test server is running in a diff port, so this will fail,
      // but the options should have default value
      if(stan.options.url === 'nats://localhost:4222') {
        done();
      }
    });
  });

  it('use binary nats connection should work', function(done) {
    var nats = NATS.connect({uri: uri, encoding: 'binary'});
    var opts = {nc: nats};
    var stan = STAN.connect(cluster, nuid.next(), opts);
    stan.on('connect', function(){
      done();
    });
  });

  it('non-binary nats connection should fail', function(done) {
    var nats = NATS.connect({uri: uri, encoding: 'utf8'});
    var opts = {nc: nats};
    var notified = false;
    try {
      STAN.connect(cluster, nuid.next(), opts);
    } catch(err){
      if(err.message.indexOf('stan: NATS connection encoding must be \'binary\'.') !== -1) {
        notified = true;
      } else {
        console.log('Failed with: ' + err);
      }
    }
    nats.close();
    if(notified) {
      done();
    } else {
      done(new Error('Connection error was not related to encoding:'));
    }
  });

  it('non-binary encoding connection should fail', function(done) {
    var notified = false;
    try {
      var opts = {encoding:'utf8'};
      STAN.connect(cluster, nuid.next(), opts);
    } catch(err){
      if(err.message.indexOf('stan: NATS connection encoding must be \'binary\'.') !== -1) {
        notified = true;
      } else {
        console.log('Failed with: ' + err);
      }
    }
    if(notified) {
      done();
    } else {
      done(new Error('Connection error was not related to encoding:'));
    }
  });


  it('should emit close', function(done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function() {
      stan.close();
    });
    stan.on('close', function() {
      done();
    });
  });

  it('should ignore multi close', function(done) {
    var stan = STAN.connect(cluster, nuid.next(), PORT);
    stan.on('connect', function() {
      stan.close();
    });
    stan.on('close', function() {
      stan.close();
      done();
    });
  });

  // it('closing nats should emit close', function(done) {
  //   this.timeout(5000);
  //   var port = 9887;
  //   var other = ssc.start_server(port, function(err) {
  //     if(err) done(err);
  //     ready();
  //   });
  //
  //   function ready() {
  //     var nats = NATS.connect({url: 'nats://localhost:' + port, encoding: 'binary'});
  //     var opts = {nc: nats};
  //
  //     var stan = STAN.connect(cluster, nuid.next(), opts);
  //     stan.on('connect', function() {
  //       other.kill();
  //     });
  //     nats.on('close', function() {
  //       should(stan.isClosed()).be.true;
  //       done();
  //     });
  //   }
  // });
});