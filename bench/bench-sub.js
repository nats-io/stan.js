#!/usr/bin/env node

/* jslint node: true */
/* jshint esversion: 6 */
'use strict';

var util = require('util');

var args = process.argv.slice(2);
var cluster_id = getFlagValue('-c') || "test-cluster";
var client_id = getFlagValue('-id') || "bench-sub";
var server = getFlagValue('-s') || 'nats://localhost:4222';
var count = getFlagValue('-mc') || 100000;
count = parseInt(count);

var subject = args[0]
if (!subject) {
  usage();
}

function getFlagValue(k) {
  var i = args.indexOf(k);
  if (i > -1) {
    var v = args[i + 1];
    args.splice(i, 2);
    return v;
  }
}

function usage() {
  console.log('bench-sub [-c clusterId] [-id clientId] [-s server] [-s server] [-mc messageCount] <subject>');
  process.exit();
}

var bufSize = count + 1;
var stan = require('../lib/stan.js').connect(cluster_id, client_id, {maxPubAcksInflight: bufSize}, server);

var start;
var end;
var received = 0;
stan.on('connect', function () {
  start = Date.now();
  let opts = stan.subscriptionOptions();
  opts.setDeliverAllAvailable(true);
  var subscription = stan.subscribe(subject, opts);
  subscription.on('error', function (err) {
    console.log('subscription for ' + this.subject + " raised an error: " + err);
  });
  subscription.on('unsubscribed', function () {
    stan.close();
  });
  subscription.on('ready', function () {
    console.log('subscribed to ' + this.subject + ' qgroup:' + this.qGroup);
  });
  subscription.on('message', done());

  function done(msg) {
    var received = 0;
    return function(msg) {
      received++;
      if(received === count) {
        var end = Date.now();
        var time = end - start;
        stan.nc.flush(function () {
          var msgPerSec = parseInt(count/(time/1000));
          console.log("Received " + count + " msgs in " + time + "ms (" + msgPerSec + " msgs/sec)");
          subscription.unsubscribe();
        });
      }
    };
  }
});


stan.on('close', function () {
  process.exit(0);
});
