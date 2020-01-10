import {connect, Message, StartPosition, version} from '..'

console.log(version);

// should allow cluster and client
let sc = connect("cluster", "client");

// should allow cluster, client and opts
sc = connect("cluster", "client", {url: "nats://localhost:4222"});
sc.publish('foo', 'hello world');
sc.publish('bar', 'hi', (err, guid) => {
    if (err) {
        console.log(`${guid} failed with ${err}`);
        return
    }
    console.log(`${guid} was published successfully`);

});

const so = sc.subscriptionOptions();
so.setMaxInFlight(100);
so.setAckWait(1000);
so.setStartAt(StartPosition.FIRST);
so.setStartAt(StartPosition.LAST_RECEIVED);
so.setStartAt(StartPosition.NEW_ONLY);
so.setStartAtSequence(1000);
so.setStartAtTimeDelta(10000);
so.setStartWithLastReceived();
so.setDeliverAllAvailable();
so.setManualAckMode(true);
so.setDurableName('durable');

let sub = sc.subscribe('foo');
if (sub.isClosed()) {
  console.log('sub is closed');
}
sub.unsubscribe();

sub = sc.subscribe('bar', 'qg');
sub.unsubscribe();

sub = sc.subscribe('bar', sc.subscriptionOptions().setManualAckMode(true));
sub.unsubscribe();

sub = sc.subscribe('bar', 'queue', sc.subscriptionOptions().setDurableName('dur').setManualAckMode(true));
sub.on('message', (msg: Message) => {
    console.log(msg.getSubject());
    console.log(msg.getSequence());
    console.log(msg.getData());
    console.log(msg.getTimestamp());
    console.log(msg.getCrc32());
    console.log(msg.isRedelivered());
    msg.getTimestampRaw();
    msg.getRawData();
    msg.ack();
});
sub.close();
sub.unsubscribe();




