import Container, { Service } from 'typedi';
import { BLOCK_COMPLETE_CHANNEL, BLOCK_START_CHANNEL } from './redis-consts';
import { IndexBuilder } from './IndexBuilder';
import IORedis = require('ioredis');
import Debug from 'debug';
import { stringifyWithTs } from '../utils/stringify';
import { logError } from '../utils/errors';

const debug = Debug('index-builder:redis-relayer');


/** 
 *  This class is listening to local events and relays them to Redis
 *  The main reason for it is to decouple most of the core classes from the 
 *  Redis infrastructure
 **/
@Service()
export class RedisRelayer {

  private redisPub: IORedis.Redis;
  private indexBuilder!: IndexBuilder

  public constructor() {
    const clientFactory = Container.get<() => IORedis.Redis>('RedisClientFactory');
    this.redisPub = clientFactory();
    this.indexBuilder = Container.get<IndexBuilder>(IndexBuilder);
    // Relay local events globablly via redis
    const events = [BLOCK_COMPLETE_CHANNEL, BLOCK_START_CHANNEL]
    events.forEach(event => {
      this.indexBuilder.on(event, 
        (data) => this.relayToRedis(event, data));
    });
  }


  private relayToRedis(topic: string, data: Record<string, unknown>) {
    debug(`Relaying to redis: ${topic} ${JSON.stringify(data)}`);
    this.redisPub.publish(topic, stringifyWithTs(data)).catch((e) => debug(`${logError(e)}`));
  }
}