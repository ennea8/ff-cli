import fs from 'fs';
import path from 'path';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getMint } from '@solana/spl-token';
import { createObjectCsvWriter } from 'csv-writer';
import { logger } from './utils';
import { readWalletsFromCSV, WalletInfo } from './utils.wallet';

// Interface for balance result
interface BalanceResult {
  address: string;
  sol_balance: number;
  token_balance?: number;
  token_mint?: string;
  error?: string;
}

// Query SOL balance for a single address
const querySolBalance = async (
  connection: Connection,
  address: string
): Promise<number> => {
  try {
    const publicKey = new PublicKey(address);
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.error(`Failed to query SOL balance for ${address}: ${error}`);
    throw error;
  }
};

// Query SPL token balance for a single address
const queryTokenBalance = async (
  connection: Connection,
  walletAddress: string,
  mintAddress: string
): Promise<number> => {
  try {
    const walletPublicKey = new PublicKey(walletAddress);
    const mintPublicKey = new PublicKey(mintAddress);
    
    // Get mint info to determine decimals
    const mintInfo = await getMint(connection, mintPublicKey);
    
    // Find associated token account
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const associatedTokenAddress = await getAssociatedTokenAddress(
      mintPublicKey,
      walletPublicKey
    );
    
    try {
      const tokenAccount = await getAccount(connection, associatedTokenAddress);
      const balance = Number(tokenAccount.amount) / Math.pow(10, mintInfo.decimals);
      return balance;
    } catch (error) {
      // Token account doesn't exist, balance is 0
      return 0;
    }
  } catch (error) {
    logger.error(`Failed to query token balance for ${walletAddress}: ${error}`);
    throw error;
  }
};

// Save results to CSV file
const saveResultsToCSV = async (
  results: BalanceResult[],
  outputPath: string,
  mintAddress?: string
): Promise<void> => {
  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Define CSV headers based on whether token balance is included
    const headers = [
      { id: 'address', title: 'Address' },
      { id: 'sol_balance', title: 'SOL Balance' },
    ];

    if (mintAddress) {
      headers.push(
        { id: 'token_balance', title: 'Token Balance' },
        { id: 'token_mint', title: 'Token Mint' }
      );
    }

    headers.push({ id: 'error', title: 'Error' });

    const csvWriter = createObjectCsvWriter({
      path: outputPath,
      header: headers,
    });

    await csvWriter.writeRecords(results);
    logger.info(`Results saved to ${outputPath}`);
  } catch (error) {
    logger.error(`Failed to save results to CSV: ${error}`);
    throw error;
  }
};

// Main function to execute balance query
export const executeBalanceQuery = async (
  rpcUrl: string,
  walletsPath: string,
  mintAddress?: string
) => {
  // Connect to the Solana cluster
  logger.info(`Connecting to Solana network at ${rpcUrl}`);
  const connection = new Connection(rpcUrl);

  // Load wallet addresses from CSV
  logger.info(`Loading wallet addresses from ${walletsPath}`);
  const wallets = readWalletsFromCSV(walletsPath);
  logger.info(`Found ${wallets.length} wallet addresses`);

  // Prepare results array
  const results: BalanceResult[] = [];

  // Query balances for each wallet
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    logger.info(`Querying balance for wallet ${i + 1}/${wallets.length}: ${wallet.address}`);

    const result: BalanceResult = {
      address: wallet.address,
      sol_balance: 0,
    };

    if (mintAddress) {
      result.token_mint = mintAddress;
      result.token_balance = 0;
    }

    try {
      // Query SOL balance
      result.sol_balance = await querySolBalance(connection, wallet.address);
      logger.info(`SOL balance: ${result.sol_balance}`);

      // Query token balance if mint address is provided
      if (mintAddress) {
        result.token_balance = await queryTokenBalance(connection, wallet.address, mintAddress);
        logger.info(`Token balance: ${result.token_balance}`);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      logger.error(`Error querying balances for ${wallet.address}: ${result.error}`);
    }

    results.push(result);
  }

  // Generate output filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const baseName = path.basename(walletsPath, path.extname(walletsPath));
  const outputFileName = mintAddress 
    ? `${baseName}_balances_${timestamp}_token.csv`
    : `${baseName}_balances_${timestamp}.csv`;
  const outputPath = path.join(process.cwd(), 'out', outputFileName);

  // Save results to CSV
  await saveResultsToCSV(results, outputPath, mintAddress);

  // Summary
  const successCount = results.filter(r => !r.error).length;
  const errorCount = results.filter(r => r.error).length;
  
  logger.info(`Balance query complete:`);
  logger.info(`- Total wallets: ${results.length}`);
  logger.info(`- Successful queries: ${successCount}`);
  logger.info(`- Failed queries: ${errorCount}`);
  logger.info(`- Results saved to: ${outputPath}`);

  if (mintAddress) {
    const totalTokenBalance = results
      .filter(r => !r.error && r.token_balance)
      .reduce((sum, r) => sum + (r.token_balance || 0), 0);
    logger.info(`- Total token balance: ${totalTokenBalance}`);
  }

  const totalSolBalance = results
    .filter(r => !r.error)
    .reduce((sum, r) => sum + r.sol_balance, 0);
  logger.info(`- Total SOL balance: ${totalSolBalance}`);
};
