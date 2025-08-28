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
import { executeFileEncryption, executeFileDecryption } from './file-crypto';
import { executeKeyCommand } from './key-utils';
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


// File encryption command
program
  .command('encrypt')
  .description('Encrypt a file with password protection')
  .requiredOption('-i, --input <path>', 'Path to input file to encrypt')
  .option('-o, --output <path>', 'Path to output encrypted file (defaults to input path + .encrypted)')
  .option('-p, --password <string>', 'Password for encryption (if not provided, will prompt)')
  .action(async (options) => {
    await executeFileEncryption(
      options.input,
      options.output,
      options.password
    );
  });

// File decryption command
program
  .command('decrypt')
  .description('Decrypt an encrypted file')
  .requiredOption('-i, --input <path>', 'Path to encrypted input file')
  .option('-o, --output <path>', 'Path to output decrypted file (defaults to input path without .encrypted extension)')
  .option('-p, --password <string>', 'Password for decryption (if not provided, will prompt)')
  .action(async (options) => {
    await executeFileDecryption(
      options.input,
      options.output,
      options.password
    );
  });

// Key pub command - get public key from private key
program
  .command('key-pub')
  .description('Display public key derived from a private key')
  .option('-k, --key-bs58 <string>', 'Private key string (base58 or array format)')
  .option('-f, --key-array-file <path>', 'Path to file containing the private key')
  .option('-o, --output <path>', 'Write output to file instead of console')
  .action(async (options) => {
    if (!options.keyBs58 && !options.keyArrayFile) {
      console.error('Error: Either --key-bs58 or --key-array-file must be provided');
      process.exit(1);
    }
    await executeKeyCommand(
      'pub',
      options.keyBs58 || options.keyArrayFile,
      options.keyArrayFile ? true : false,
      options.output
    );
  });

// Key bs58 command - convert array to base58
program
  .command('key-bs58')
  .description('Convert array format key to base58 string')
  .option('-k, --key-array <string>', 'Array format key string')
  .option('-f, --key-array-file <path>', 'Path to file containing array format key')
  .option('-o, --output <path>', 'Write output to file instead of console')
  .action(async (options) => {
    if (!options.keyArray && !options.keyArrayFile) {
      console.error('Error: Either --key-array or --key-array-file must be provided');
      process.exit(1);
    }
    await executeKeyCommand(
      'bs58',
      options.keyArray || options.keyArrayFile,
      options.keyArrayFile ? true : false,
      options.output
    );
  });

// Key array command - convert base58 to array format
program
  .command('key-array')
  .description('Convert base58 string to array format key for file storage')
  .option('-k, --key-bs58 <string>', 'Base58 format key string')
  .option('-f, --key-bs58-file <path>', 'Path to file containing base58 format key')
  .option('-o, --output <path>', 'Write output to file instead of console')
  .action(async (options) => {
    if (!options.keyBs58 && !options.keyBs58File) {
      console.error('Error: Either --key-bs58 or --key-bs58-file must be provided');
      process.exit(1);
    }
    await executeKeyCommand(
      'array',
      options.keyBs58 || options.keyBs58File,
      options.keyBs58File ? true : false,
      options.output
    );
  });

program
  .version(getVersion())
  .description('FF CLI tools for Solana operations')
  .parse();