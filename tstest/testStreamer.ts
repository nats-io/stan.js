import { Stream } from "./streamer";
import { StanOptions, Message } from "..";



(async function connect() {
    const clientID = "client1";
    const clusterID = "nats-streaming";
    const server = "nats://localhost:14222";

    const opts: StanOptions & { durableName: string, ackWait: number } = {
        ackTimeout: 4,
        durableName: "durableName",
        ackWait: 5
    };
    const stream = new Stream(clusterID, clientID, server as any, opts);
    await stream.connect();

    console.log("connected")

    console.log("calling subscription")
    const subscription = await stream.subscribe("mysubject");
    console.log("got subscription")

    subscription.on('message', (message: Message) => {
        console.log(message.getData());
    });

    subscription.on('error', (err) => {
        console.log('subscription failed', err);
    });
    subscription.on('timeout', (err) => {
        console.log('subscription timeout', err)
    });
    subscription.on('unsubscribed', () => {
        console.log('subscription unsubscribed')
    });

    let i = 0;
    setInterval(() => {
        stream.publish({
            subject: "mysubject",
            data: `a small chunk of data ::: ${i}`
        })
        i+=10;
   }, 200)

})();