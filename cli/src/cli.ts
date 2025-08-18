#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
const program = new Command();

// Load environment variables from .env file
dotenv.config();

import { executeTransfer } from './solana-transfer';
import { executeTokenTransfer } from './token-transfer';
import { executeBalanceQuery } from './balance-query';
import { executeBatchTransfer } from './batch-transfer';

// One-to-many transfer command (unified SOL and token transfers)
program
  .command('transfer-one2many')
  .description('Transfer SOL or tokens from one address to multiple recipients')
  .requiredOption('--keypair <path>', 'Path to sender keypair file', process.env.SOLANA_KEYPAIR_PATH)
  .requiredOption('--receivers <path>', 'Path to CSV file containing receiver addresses and amounts')
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .option('--mint <address>', 'SPL Token mint address (if not provided, transfers SOL)')
  .option('--batch-size <size>', 'Number of transfers to process in a batch', (value) => parseInt(value, 10), 1)
  .action(async (options) => {
    if (options.mint) {
      // Token transfer
      await executeTokenTransfer(
        options.rpc,
        options.keypair,
        options.receivers,
        options.mint,
        options.batchSize
      );
    } else {
      // SOL transfer
      await executeTransfer(
        options.rpc,
        options.keypair,
        options.receivers,
        options.batchSize
      );
    }
  });

// Many-to-many transfer command
program
  .command('transfer-many2many')
  .description('Execute many-to-many transfers using wallet private keys and transfer instructions')
  .requiredOption('--wallets <path>', 'Path to CSV file containing wallet addresses and private keys (address,base58,array)')
  .requiredOption('--transfers <path>', 'Path to CSV file containing transfer instructions (from,to,amount)')
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .option('--mint <address>', 'SPL Token mint address (if not provided, transfers SOL)')
  .action(async (options) => {
    await executeBatchTransfer(
      options.rpc,
      options.wallets,
      options.transfers,
      options.mint
    );
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
  .version('0.0.5')
  .description('FF CLI tools for Solana operations')
  .parse();