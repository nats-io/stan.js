/**
 * @author [Shanur]
 * @email [shanur.cse.nitap@gmail.com]
 * @create date 2020-05-14 23:17:35
 * @modify date 2020-05-14 23:17:35
 * @desc [This provides a steaming connection to nats server]
 */

import { connect, StanOptions, Stan, SubscriptionOptions, Subscription, StartPosition } from "..";

export class Stream {
    private clusterID: string;
    private clientID: string;
    private options: SubscriptionOptions;
    private sc: Stan;
    private server: string;

    constructor(clusterID: string, clientID: string, server: string, opts: StanOptions) {
        this.clusterID = clusterID;
        this.clientID = clientID;
        this.options = opts as any;
        this.server = server;
    }

    connect(): Promise<Stan> {
        this.sc = connect(this.clusterID, this.clientID, this.server as any);
        this.sc.on('error', (reason) => {
            console.log(reason)
        });

        return new Promise((resolve, reject) => {
            this.sc.on('connect', () => {
                console.log('Connected to Nats streaming server!')
                const so = this.sc.subscriptionOptions()
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

                resolve(this.sc);
            })
        })
    }


    public publish(payload: any) {
        console.log(payload)
        this.sc.publish(payload.subject, payload.data);
    }


    /** resolves a subscription when subscription is ready to receive message events */
    public async subscribe(subject: string): Promise<Subscription> {
        const subscription = this.sc.subscribe(subject);

        console.log("subscribed successfully");
        return new Promise((resolve, reject) => {
            subscription.on('ready', () => {
                console.log('ready');

                /** resolve subscription when ready to receive messages */
                resolve(subscription)
            });
        })
    }
}