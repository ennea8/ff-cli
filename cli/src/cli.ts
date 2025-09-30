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
import { executeBalance } from './balance';
import { executeDrainWallet } from './drain-wallet';
import { executeBatchDrainWallet } from './batch-drain-wallet';
import { executeSolWrapping } from './sol-wrap-unwrap';
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
  .description('Generate random Solana wallets and save to file')
  .requiredOption('--count <number>', 'Number of wallets to generate', (value) => parseInt(value, 10))
  .option('--output <path>', 'Output file path (optional)')
  .option('--json', 'Output in JSON format compatible with web3.Keypair.fromSecretKey', false)
  .action(async (options) => {
    await executeWalletGeneration(
      options.count,
      options.output,
      options.json
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

// Balance command for a single address
program
  .command('balance')
  .description('Query SOL and token balance for a specific address')
  .requiredOption('--address <string>', 'Wallet address to query balance for')
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .option('--mint <address>', 'SPL Token mint address to query token balance')
  .action(async (options) => {
    await executeBalance(
      options.rpc,
      options.address,
      options.mint
    );
  });

// Drain wallet command - transfer all assets and close accounts
program
  .command('drain-wallet')
  .description('Transfer all assets from one wallet to another and close accounts to reclaim rent')
  .option('--from-key-file <path>', 'Path to source wallet keypair file (array format)')
  .option('--from-key-bs58 <string>', 'Source wallet private key in base58 format')
  .requiredOption('--to <address>', 'Destination wallet address')
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .option('--dry-run', 'Simulate the operation without executing transfers', false)
  .option('--no-close-accounts', 'Skip closing token accounts')
  .option('--no-reclaim-rent', 'Skip rent reclamation')
  .option('--keep-sol <amount>', 'Amount of SOL to keep in source wallet', (value) => parseFloat(value), 0)
  .option('--tokens <list>', 'Comma-separated list of specific token mints to transfer')
  .option('--exclude-tokens <list>', 'Comma-separated list of token mints to exclude from transfer')
  .option('--min-balance <amount>', 'Minimum token balance to transfer (skip dust)', (value) => parseFloat(value), 0)
  .action(async (options) => {
    if (!options.fromKeyFile && !options.fromKeyBs58) {
      console.error('Error: Either --from-key-file or --from-key-bs58 must be provided');
      process.exit(1);
    }
    
    if (options.fromKeyFile && options.fromKeyBs58) {
      console.error('Error: Cannot provide both --from-key-file and --from-key-bs58');
      process.exit(1);
    }

    const tokens = options.tokens ? options.tokens.split(',').map((t: string) => t.trim()) : undefined;
    const excludeTokens = options.excludeTokens ? options.excludeTokens.split(',').map((t: string) => t.trim()) : undefined;
    
    await executeDrainWallet(
      options.rpc,
      options.fromKeyFile,
      options.fromKeyBs58,
      options.to,
      {
        dryRun: options.dryRun,
        closeAccounts: options.closeAccounts,
        reclaimRent: options.reclaimRent,
        keepSol: options.keepSol,
        tokens,
        excludeTokens,
        minBalance: options.minBalance,
      }
    );
  });

// Batch drain wallet command - transfer all assets from multiple wallets to their destinations
program
  .command('batch-drain-wallet')
  .description('Batch transfer all assets from multiple wallets to their respective destinations')
  .requiredOption('--from-wallets <path>', 'Path to CSV file with source wallet addresses and private keys (3-column format)')
  .requiredOption('--to-addresses <path>', 'Path to file with destination addresses (can be single column or CSV)')
  .option('--indices <list>', 'Comma-separated list of specific indices to process (e.g., "0,2,5")')
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .option('--dry-run', 'Simulate the operation without executing transfers', false)
  .option('--no-close-accounts', 'Skip closing token accounts')
  .option('--no-reclaim-rent', 'Skip rent reclamation')
  .option('--keep-sol <amount>', 'Amount of SOL to keep in source wallet', (value) => parseFloat(value), 0)
  .option('--tokens <list>', 'Comma-separated list of specific token mints to transfer')
  .option('--exclude-tokens <list>', 'Comma-separated list of token mints to exclude from transfer')
  .option('--min-balance <amount>', 'Minimum token balance to transfer (skip dust)', (value) => parseFloat(value), 0)
  .action(async (options) => {
    const tokens = options.tokens ? options.tokens.split(',').map((t: string) => t.trim()) : undefined;
    const excludeTokens = options.excludeTokens ? options.excludeTokens.split(',').map((t: string) => t.trim()) : undefined;
    
    // 处理索引参数
    const indices = options.indices ? options.indices.split(',').map((i: string) => parseInt(i.trim(), 10)) : [];
    
    await executeBatchDrainWallet(
      options.rpc,
      options.fromWallets,
      options.toAddresses,
      {
        dryRun: options.dryRun,
        closeAccounts: options.closeAccounts,
        reclaimRent: options.reclaimRent,
        keepSol: options.keepSol,
        tokens,
        excludeTokens,
        minBalance: options.minBalance,
        indices: indices.length > 0 ? indices : undefined, // 如果有指定索引，则传入
      }
    );
  });

// SOL wrap/unwrap combined command
program
  .command('sol-wrap-unwrap')
  .description('Wrap SOL to wSOL and unwrap wSOL to SOL')
  .option('--from-key-file <path>', 'Path to source wallet keypair file (array format)')
  .option('--from-key-bs58 <string>', 'Source wallet private key in base58 format')
  .option('--key-array-file <path>', 'Alias for --from-key-file')
  .option('--key-bs58 <string>', 'Alias for --from-key-bs58')
  .option('--wallets <path>', 'Path to CSV file containing wallet addresses and private keys (address,base58,array)')
  .option('--action <action>', 'Action to perform: wrap (SOL to wSOL) or unwrap (wSOL to SOL)', 'wrap')
  .option('--amount <sol>', 'Amount of SOL to wrap/unwrap (applies only to single wallet)', (val) => parseFloat(val))
  .option('--min-sol-balance <sol>', 'Minimum SOL balance to keep when wrapping', (val) => parseFloat(val), 0.02)
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .action(async (options) => {
    // Check if either direct key or wallet file is provided
    if (!options.fromKeyFile && !options.fromKeyBs58 && 
        !options.keyArrayFile && !options.keyBs58 && 
        !options.wallets) {
      console.error('Error: Either --from-key-file, --from-key-bs58, --key-array-file, --key-bs58, or --wallets must be provided');
      process.exit(1);
    }

    // Map the alias options to standard options
    const keyFile = options.fromKeyFile || options.keyArrayFile;
    const keyBs58 = options.fromKeyBs58 || options.keyBs58;

    // Validate action
    const action = options.action.toLowerCase();
    if (action !== 'wrap' && action !== 'unwrap') {
      console.error('Error: --action must be either "wrap" or "unwrap"');
      process.exit(1);
    }

    await executeSolWrapping(
      options.rpc,
      action,
      keyFile,
      keyBs58,
      {
        minSolBalance: options.minSolBalance,
        amount: options.amount,
        walletPath: options.wallets
      }
    );
  });

// Separate commands for wrap and unwrap
program
  .command('wrap-sol')
  .description('Wrap SOL to wSOL')
  .option('--from-key-file <path>', 'Path to source wallet keypair file (array format)')
  .option('--from-key-bs58 <string>', 'Source wallet private key in base58 format')
  .option('--key-array-file <path>', 'Alias for --from-key-file')
  .option('--key-bs58 <string>', 'Alias for --from-key-bs58')
  .option('--wallets <path>', 'Path to CSV file containing wallet addresses and private keys (address,base58,array)')
  .option('--amount <sol>', 'Amount of SOL to wrap (applies only to single wallet)', (val) => parseFloat(val))
  .option('--min-sol-balance <sol>', 'Minimum SOL balance to keep when wrapping', (val) => parseFloat(val), 0.02)
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .action(async (options) => {
    // Check if either direct key or wallet file is provided
    if (!options.fromKeyFile && !options.fromKeyBs58 && 
        !options.keyArrayFile && !options.keyBs58 && 
        !options.wallets) {
      console.error('Error: Either --from-key-file, --from-key-bs58, --key-array-file, --key-bs58, or --wallets must be provided');
      process.exit(1);
    }

    // Map the alias options to standard options
    const keyFile = options.fromKeyFile || options.keyArrayFile;
    const keyBs58 = options.fromKeyBs58 || options.keyBs58;

    await executeSolWrapping(
      options.rpc,
      'wrap',
      keyFile,
      keyBs58,
      {
        minSolBalance: options.minSolBalance,
        amount: options.amount,
        walletPath: options.wallets
      }
    );
  });

program
  .command('unwrap-sol')
  .description('Unwrap wSOL to SOL')
  .option('--from-key-file <path>', 'Path to source wallet keypair file (array format)')
  .option('--from-key-bs58 <string>', 'Source wallet private key in base58 format')
  .option('--key-array-file <path>', 'Alias for --from-key-file')
  .option('--key-bs58 <string>', 'Alias for --from-key-bs58')
  .option('--wallets <path>', 'Path to CSV file containing wallet addresses and private keys (address,base58,array)')
  .option('--amount <sol>', 'Amount of wSOL to unwrap (applies only to single wallet)', (val) => parseFloat(val))
  .option('--rpc <url>', 'Solana RPC URL', process.env.SOLANA_RPC_URL)
  .action(async (options) => {
    // Check if either direct key or wallet file is provided
    if (!options.fromKeyFile && !options.fromKeyBs58 && 
        !options.keyArrayFile && !options.keyBs58 && 
        !options.wallets) {
      console.error('Error: Either --from-key-file, --from-key-bs58, --key-array-file, --key-bs58, or --wallets must be provided');
      process.exit(1);
    }

    // Map the alias options to standard options
    const keyFile = options.fromKeyFile || options.keyArrayFile;
    const keyBs58 = options.fromKeyBs58 || options.keyBs58;

    await executeSolWrapping(
      options.rpc,
      'unwrap',
      keyFile,
      keyBs58,
      {
        amount: options.amount,
        walletPath: options.wallets
      }
    );
  });

program
  .version(getVersion())
  .description('FF CLI tools for Solana operations')
  .parse();