#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
const program = new Command();

// Load environment variables from .env file
dotenv.config();

import { sayHello } from './hello';
import { executeTransfer } from './solana-transfer';

program.command('say-hello')
  .description('Say hello')
  .action(sayHello);

// Solana transfer command
program
  .command('solana-transfer')
  .description('Batch transfer SOL to multiple addresses')
  .requiredOption('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .requiredOption('--keypair <path>', 'Path to sender keypair file', process.env.SOLANA_KEYPAIR_PATH)
  .requiredOption('--receivers <path>', 'Path to CSV file containing receiver addresses and amounts')
  .option('--batch-size <size>', 'Number of transfers to process in a batch', (value) => parseInt(value, 10), 1)
  .action(async (options) => {
    await executeTransfer(
      options.rpc,
      options.keypair,
      options.receivers,
      options.batchSize
    );
  });

program
  .version('1.0.0')
  .description('FF CLI tools for Solana operations')
  .parse();