#!/usr/bin/env node

"use-strict";

var stan = require('node-nats-streaming').connect('test-cluster', 'test');

stan.on('connect', function () {

  // Simple Publisher (all publishes are async in the node version of the client)
  stan.publishAsync('foo', 'Hello node-nats-streaming!', function(err, guid){
    if(err) {
      console.log('publish failed: ' + err);
    } else {
      console.log('published message with guid: ' + guid);
    }
  });

  // Subscriber can specify how many existing messages to get.
  var opts = stan.subscriptionOptions().setStartWithLastReceived();
  var subscription = stan.subscribe('foo', opts);
  subscription.on('message', function (msg) {
    console.log('Received a message [' + msg.getSequence() + '] ' + msg.getData());
  });

  setTimeout(function() {
    subscription.unsubscribe();
    subscription.on('unsubscribed', function() {
      stan.close();
    });
  }, 1000);
});

stan.on('close', function() {
  process.exit();
});
