#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
const program = new Command();

// Load environment variables from .env file
dotenv.config();

import { sayHello } from './hello';
import { executeTransfer } from './solana-transfer';
import { executeTokenTransfer } from './token-transfer';
import { executeBalanceQuery } from './balance-query';

program.command('say-hello')
  .description('Say hello')
  .action(sayHello);

// Solana transfer command
program
  .command('solana-transfer')
  .description('Batch transfer SOL to multiple addresses')
  .requiredOption('--keypair <path>', 'Path to sender keypair file', process.env.SOLANA_KEYPAIR_PATH)
  .requiredOption('--receivers <path>', 'Path to CSV file containing receiver addresses and amounts')
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .option('--batch-size <size>', 'Number of transfers to process in a batch', (value) => parseInt(value, 10), 1)
  .action(async (options) => {
    await executeTransfer(
      options.rpc,
      options.keypair,
      options.receivers,
      options.batchSize
    );
  });

// SPL Token batch transfer command
program
  .command('token-transfer')
  .description('Batch transfer SPL tokens to multiple addresses')
  .requiredOption('--keypair <path>', 'Path to keypair file', process.env.SOLANA_KEYPAIR_PATH)
  .requiredOption('--receivers <path>', 'Path to CSV file with receivers')
  .requiredOption('--mint <address>', 'SPL Token mint address')
  .option('--rpc <url>', 'RPC URL', process.env.SOLANA_RPC_URL)
  .option('--batch-size <number>', 'Number of transfers per batch', (value) => parseInt(value, 10), 1)
  .action((options) => {
    const { keypair, receivers, rpc, mint, batchSize } = options;
    executeTokenTransfer(rpc, keypair, receivers, mint, batchSize);
  });

// Balance query command
program
  .command('balance-query')
  .description('Query SOL and token balances for a list of wallet addresses')
  .requiredOption('--wallets <path>', 'Path to CSV file containing wallet addresses')
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .option('--mint <address>', 'SPL Token mint address to query token balances')
  .action(async (options) => {
    await executeBalanceQuery(
      options.rpc,
      options.wallets,
      options.mint
    );
  });

program
  .version('0.0.4')
  .description('FF CLI tools for Solana operations')
  .parse();