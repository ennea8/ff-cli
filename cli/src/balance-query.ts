import fs from 'fs';
import path from 'path';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { createObjectCsvWriter } from 'csv-writer';
import { logger } from './utils';
import { readWalletsFromCSV, WalletInfo } from './utils.wallet';

// Interface for token account info
interface TokenAccountInfo {
  address: string;
  balance: number;
  rawBalance: string;
  decimals: number;
  programId: string;
  state: string;
}

// Interface for balance result
interface BalanceResult {
  address: string;
  sol_balance: number;
  token_balance?: number;
  token_accounts_count?: number;
  token_mint?: string;
  token_type?: string;
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

// Query comprehensive token balance for a single address
const queryTokenBalance = async (
  connection: Connection,
  walletAddress: string,
  mintAddress: string
): Promise<{ balance: number; accountsCount: number; tokenType: string }> => {
  try {
    const owner = new PublicKey(walletAddress);
    const mint = new PublicKey(mintAddress);
    
    const accounts: TokenAccountInfo[] = [];
    let tokenType = "SPL Token";
    
    // Query SPL Token program accounts
    logger.info(`Querying SPL Token accounts for ${walletAddress.substring(0, 8)}...`);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
    
    // Process SPL Token results
    for (const { pubkey, account } of tokenAccounts.value) {
      const parsedInfo = account.data.parsed.info;
      const balance = parsedInfo.tokenAmount.uiAmount || 0;
      const decimals = parsedInfo.tokenAmount.decimals;
      const rawBalance = parsedInfo.tokenAmount.amount;
      
      accounts.push({
        address: pubkey.toString(),
        balance,
        rawBalance,
        decimals,
        programId: account.owner.toString(),
        state: parsedInfo.state,
      });
    }
    
    // Check if this is a Token-2022 mint and query Token-2022 accounts
    try {
      const mintInfo = await connection.getAccountInfo(mint);
      if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        tokenType = "Token-2022";
        logger.info(`Token is Token-2022 type, querying Token-2022 accounts...`);
        
        const token2022Accounts = await connection.getParsedTokenAccountsByOwner(owner, { 
          mint,
          programId: TOKEN_2022_PROGRAM_ID
        });
        
        // Process Token-2022 results
        for (const { pubkey, account } of token2022Accounts.value) {
          const parsedInfo = account.data.parsed.info;
          const balance = parsedInfo.tokenAmount.uiAmount || 0;
          const decimals = parsedInfo.tokenAmount.decimals;
          const rawBalance = parsedInfo.tokenAmount.amount;
          
          // Avoid duplicate accounts
          if (!accounts.some(acc => acc.address === pubkey.toString())) {
            accounts.push({
              address: pubkey.toString(),
              balance,
              rawBalance,
              decimals,
              programId: account.owner.toString(),
              state: parsedInfo.state,
            });
          }
        }
      }
    } catch (error) {
      logger.warn(`Error checking token type: ${error instanceof Error ? error.message : error}`);
    }
    
    // Calculate total balance
    const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
    
    return {
      balance: totalBalance,
      accountsCount: accounts.length,
      tokenType
    };
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
        { id: 'token_accounts_count', title: 'Token Accounts Count' },
        { id: 'token_mint', title: 'Token Mint' },
        { id: 'token_type', title: 'Token Type' }
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
      result.token_accounts_count = 0;
      result.token_type = 'SPL Token';
    }

    try {
      // Query SOL balance
      result.sol_balance = await querySolBalance(connection, wallet.address);
      logger.info(`SOL balance: ${result.sol_balance}`);

      // Query token balance if mint address is provided
      if (mintAddress) {
        const tokenInfo = await queryTokenBalance(connection, wallet.address, mintAddress);
        result.token_balance = tokenInfo.balance;
        result.token_accounts_count = tokenInfo.accountsCount;
        result.token_type = tokenInfo.tokenType;
        logger.info(`Token balance: ${result.token_balance} (${tokenInfo.accountsCount} accounts, ${tokenInfo.tokenType})`);
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
