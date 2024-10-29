export default () => ({
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  chromia: {
    nodeUrl: process.env.CHROMIA_NODE_URL,
    blockchainRid: process.env.CHROMIA_BLOCKCHAIN_RID,
    adminPrivateKey: process.env.CHROMIA_ADMIN_PRIVATE_KEY,
  },
});
