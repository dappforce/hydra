import { ConnectionOptions } from 'typeorm'
import { SnakeNamingStrategy } from '@dzlzv/hydra-db-utils'
import { ProcessedEventsLogEntity } from '../entities/ProcessedEventsLogEntity'
import { ProcessorSchema } from '../migrations/ProcessorSchema'

const config: () => ConnectionOptions = () => {
  return {
    type: 'postgres',
    host: process.env.TYPEORM_HOST || process.env.DB_HOST,
    port: parseInt(
      process.env.TYPEORM_PORT || process.env.DB_PORT || '5432',
      10
    ),
    username: process.env.TYPEORM_USERNAME || process.env.DB_USER,
    password: process.env.TYPEORM_PASSWORD || process.env.DB_PASS,
    database: process.env.TYPEORM_DATABASE || process.env.DB_NAME,
    entities: [ProcessedEventsLogEntity, process.env.TYPEORM_ENTITIES],
    migrations: [ProcessorSchema],
    cli: {
      migrationsDir: 'migrations',
    },
    logging: process.env.TYPEORM_LOGGING === 'true',
    namingStrategy: new SnakeNamingStrategy(),
  } as ConnectionOptions
}

export default config
