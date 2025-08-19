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
import { executeFundAllocation } from './fund-allocation';
import { executeWalletGeneration } from './wallet-generator';
import fs from 'fs';
import path from 'path';

// Read version from package.json
const getVersion = (): string => {
  try {
    // Try multiple possible paths for package.json
    const possiblePaths = [
      path.join(__dirname, '../../package.json'),     // For dev environment (cli/src/)
      path.join(__dirname, '../package.json'),        // For npm published package (dist/ -> root)
      path.join(__dirname, '../../../package.json'),  // For local build environment (dist/cli/src/)
      path.join(process.cwd(), 'package.json')        // Fallback to current working directory
    ];
    
    for (const packageJsonPath of possiblePaths) {
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return packageJson.version;
      }
    }
    
    return '0.0.0'; // fallback version if no package.json found
  } catch (error) {
    return '0.0.0'; // fallback version
  }
};

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

// Fund allocation command
program
  .command('allocate-funds')
  .description('Generate fund allocation plan for 1-to-many transfers')
  .requiredOption('--wallets <path>', 'Path to CSV file containing wallet addresses')
  .requiredOption('--min <amount>', 'Minimum amount per wallet', (value) => parseFloat(value))
  .requiredOption('--max <amount>', 'Maximum amount per wallet', (value) => parseFloat(value))
  .option('--total <amount>', 'Total amount to distribute (optional)', (value) => parseFloat(value))
  .option('--decimals <places>', 'Number of decimal places for amounts', (value) => parseInt(value, 10), 4)
  .option('--output <path>', 'Output CSV file path (optional)')
  .action(async (options) => {
    await executeFundAllocation(
      options.wallets,
      options.min,
      options.max,
      options.total,
      options.decimals,
      options.output
    );
  });

// Wallet generation command
program
  .command('generate-wallets')
  .description('Generate random Solana wallets and save to CSV file')
  .requiredOption('--count <number>', 'Number of wallets to generate', (value) => parseInt(value, 10))
  .option('--output <path>', 'Output CSV file path (optional)')
  .action(async (options) => {
    await executeWalletGeneration(
      options.count,
      options.output
    );
  });


program
  .version(getVersion())
  .description('FF CLI tools for Solana operations')
  .parse();