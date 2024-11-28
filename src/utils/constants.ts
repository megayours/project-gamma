export const Constants = {
  // Time intervals
  FIVE_MINUTES_MS: 5 * 60 * 1000,
  ONE_MINUTE_MS: 60 * 1000,
  ONE_SECOND_MS: 1000,
  TEN_SECONDS_MS: 10 * 1000,

  // Block ranges
  MAX_BLOCK_RANGE: 1999,

  // Retry settings
  MAX_RETRIES: 5,

  // Queue settings
  QUEUE_SIZE_THRESHOLD: 10000,
  QUEUE_CHECK_INTERVAL_MS: 10 * 1000, // 10 seconds

  // Metadata update settings
  METADATA_UPDATE_BATCH_SIZE: 10,

  // Redis settings
  REDIS_EXPIRY_TIME_SECONDS: 3600, // 1 hour

  // Event processing
  MAX_EVENTS_PER_QUERY: 10000,

  // HTTP status codes
  HTTP_STATUS_SERVER_ERROR: 500,

  // Blockchain specific
  TRANSFER_EVENT_NAME: 'Transfer',
  TRANSFER_SINGLE_EVENT_NAME: 'TransferSingle',

  // File paths
  DEFAULT_ENV_PATH: '.env',

  // Logging
  DEFAULT_LOG_LEVEL: 'info',

  // Chromia transaction batching
  CHROMIA_BATCH_SIZE: 100,
  CHROMIA_MAX_BATCH_WAIT_MS: 10000, // 10 seconds max wait time
  CHROMIA_BATCH_CHECK_INTERVAL_MS: 15000, // 15 seconds max wait time
};
