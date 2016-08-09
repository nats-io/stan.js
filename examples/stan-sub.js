#!/usr/bin/env node

/* jslint node: true */
/* jshint esversion: 6 */
'use strict';

var util = require('util');

var args = process.argv.slice(2);
var cluster_id = getFlagValue('-c') || "test-cluster";
var client_id = getFlagValue('-id') || "node-stan-sub";
var queue_group = getFlagValue('-q') || '';
var server = getFlagValue('-s') || 'nats://localhost:4222';

var subject = args[0];
if (!subject) {
  usage();
}

function usage() {
  console.log('stan-sub [-c clusterId] [-id clientId] [-s server] [-q queueGroup] [-s server] <subject>');
  process.exit();
}

function getFlagValue(k) {
  var i = args.indexOf(k);
  if (i > -1) {
    var v = args[i + 1];
    args.splice(i, 2);
    return v;
  }
}


var stan = require('../lib/stan.js').connect(cluster_id, client_id, server);
stan.on('connect', function () {
  console.log("STAN connected!");
  start();
});

function start() {
  var opts = stan.subscriptionOptions();
  opts.setStartWithLastReceived();

  var subscription = stan.subscribe(subject, queue_group, opts);
  subscription.on('error', function (err) {
    console.log('subscription for ' + this.subject + " raised an error: " + err);
  });
  subscription.on('unsubscribed', function () {
    console.log('unsubscribed to ' + this.subject);
  });
  subscription.on('ready', function () {
    console.log('subscribed to ' + this.subject + ' qgroup:' + this.qGroup);
  });
  subscription.on('message', function (msg) {
    console.log(msg.getSubject() + "[" + msg.getSequence() + "]: " + msg.getData());
  });
}