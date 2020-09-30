// @ts-check
import { QueryEventBlock } from '../model';
import * as _ from 'lodash';

import Debug from 'debug';
import { doInTransaction } from '../db/helper';
import { PooledExecutor } from './PooledExecutor';
import { SubstrateEventEntity } from '../entities';
import { numberEnv } from '../utils/env-flags';
import { IndexerStatusService } from './IndexerStatusService';
import { Inject, Service } from 'typedi';
//import * as IORedis from 'ioredis';
import { withTs } from '../utils/stringify';
import { BLOCK_START_CHANNEL, BLOCK_COMPLETE_CHANNEL } from './redis-consts';
import { IBlockProducer } from './IBlockProducer';
import { assert } from 'console';
import { EventEmitter } from 'events';

const debug = Debug('index-builder:indexer');

const WORKERS_NUMBER = numberEnv('INDEXER_WORKERS') || 50;

export interface BlockPayload {
  height: number,
  ts: number 
  events?: { id: string, name: string }[]
}

@Service('IndexBuilder')
export class IndexBuilder extends EventEmitter {
  private _stopped = false;
  //private redisPub: IORedis.Redis;
  
  @Inject('BlockProducer') private producer!: IBlockProducer<QueryEventBlock>;
  @Inject('StatusService') protected statusService!: IndexerStatusService;

  public constructor() {
    super();
  }

  async start(atBlock?: number): Promise<void> {
    assert(this.producer, 'BlockProducer must be set');
    assert(this.statusService, 'StatusService must be set');
    
    debug('Spawned worker.');
    
    const lastHead = await this.statusService.getIndexerHead();
    
    debug(`Last indexed block in the database: ${lastHead.toString()}`);
    let startBlock = lastHead + 1;
    
    if (atBlock) {
      debug(`Got block height hint: ${atBlock}`);
      if (lastHead >= 0 && process.env.FORCE_BLOCK_HEIGHT !== 'true') {
        debug(
          `WARNING! The database contains indexed blocks.
          The last indexed block height is ${lastHead}. The indexer 
          will continue from block ${lastHead} ignoring the start 
          block height hint. Set the environment variable FORCE_BLOCK_HEIGHT to true 
          if you want to start from ${atBlock} anyway.`
        );
      } else {
        startBlock = Math.max(startBlock, atBlock);
      }
    }

    debug(`Starting the block indexer at block ${startBlock}`);

    await this.producer.start(startBlock);

    const poolExecutor = new PooledExecutor(WORKERS_NUMBER, this.producer.blockHeights(), this._indexBlock());
    
    debug('Started a pool of indexers.');

    await poolExecutor.run(() => this._stopped);

  }

  stop(): void { 
    debug('Index builder has been stopped');
    this._stopped = true;
  }

  _indexBlock(): (h: number) => Promise<void> {
    return async (h: number) => {
      debug(`Processing block #${h.toString()}`); 
      
      const done = await this.statusService.isComplete(h);
      if (done) {
        debug(`Block ${h} has already been indexed`);
        return;
      }
      
      this.emit(BLOCK_START_CHANNEL, {
        height: h,
      })

      const queryEventsBlock: QueryEventBlock = await this.producer.fetchBlock(h);
    
      await this.transformAndPersist(queryEventsBlock);
      debug(`Done block #${h.toString()}`);
    
      this.emit(BLOCK_COMPLETE_CHANNEL, this.toPayload(queryEventsBlock));
    }
  }
  
  async transformAndPersist(queryEventsBlock: QueryEventBlock): Promise<void> {
    const batches = _.chunk(queryEventsBlock.query_events, 100);
    debug(`Read ${queryEventsBlock.query_events.length} events; saving in ${batches.length} batches`);  
    
    await doInTransaction(async (queryRunner) => {
      debug(`Saving event entities`);

      let saved = 0;
      for (let batch of batches) {
        const qeEntities = batch.map((event) => SubstrateEventEntity.fromQueryEvent(event));
        await queryRunner.manager.save(qeEntities);
        saved += qeEntities.length;
        batch = [];
        debug(`Saved ${saved} events`);
      }
    }); 
  }

  toPayload(qeb: QueryEventBlock): BlockPayload {
    return (withTs({
      height: qeb.block_number,
      events: qeb.query_events.map((e) => {
        return {
          name: e.event_name,
          id: SubstrateEventEntity.formatId(qeb.block_number, e.index)
        }
      })
    }) as unknown) as BlockPayload
  }
}
