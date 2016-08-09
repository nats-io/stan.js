#!/usr/bin/env node

/* jslint node: true */
/* jshint esversion: 6 */
'use strict';

var util = require('util');

var args = process.argv.slice(2);
var cluster_id = getFlagValue('-c') || "test-cluster";
var client_id = getFlagValue('-id') || "bench-pub";
var server = getFlagValue('-s') || 'nats://localhost:4222';
var count = getFlagValue('-mc') || 100000;
count = parseInt(count);

var subject = args[0]
var body = args[1] || '';
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
  console.log('bench-pub [-c clusterId] [-id clientId] [-s server] [-s server] <subject> <msg>');
  process.exit();
}

var stan = require('../lib/stan.js').connect(cluster_id, client_id, server);

var start;
var sent = 0;
stan.on('connect', function () {
  start = Date.now();
  sendMore(count);
});

stan.on('close', function () {
  process.exit(0);
});

function send(n) {
  var max = parseInt(n / 2);

  var callbackCount = 0;
  for (var i = 0; i < n; i++) {
    stan.publishAsync(subject, body, function (err, guid) {
      callbackCount++;
      if (err) {
        console.log(i + " " + err);
        process.exit(1);
      }
      if (callbackCount === max) {
        process.nextTick(sendMore, n);
      }
    });
    sent++;
    if (sent % 10000 === 0) {
      process.stdout.write('+');
    }
  }
}


function sendMore(n) {
  if (sent == count) {
    var end = Date.now();
    var time = end - start;
    var msgPerSec = parseInt((count * 1000) / time);
    console.log('\nReceived ' + count + ' msgs in ' + time + 'ms (' + msgPerSec + ' msgs/sec)');
    stan.nc.flush(function () {
      stan.close();
    });
    return;
  }

  if (sent <= count) {
    var left = count - sent;
    var toSend = left < 10000 ? left : 10000;
    process.nextTick(send, toSend);
  }
}


