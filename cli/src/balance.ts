import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { logger } from './utils';

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

// Query token balance for a single address and mint
const queryTokenBalance = async (
  connection: Connection,
  walletAddress: string,
  mintAddress: string
): Promise<{ balance: number; accountsCount: number; tokenType: string }> => {
  try {
    const owner = new PublicKey(walletAddress);
    const mint = new PublicKey(mintAddress);
    
    const accounts: {
      address: string;
      balance: number;
      rawBalance: string;
      decimals: number;
      programId: string;
      state: string;
    }[] = [];
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

// Display results in a nice format
const displayBalanceResults = (
  address: string, 
  solBalance: number, 
  tokenBalance?: { 
    balance: number; 
    accountsCount: number; 
    tokenType: string; 
    mintAddress: string 
  }
): void => {
  console.log(`\n${'Balance Results:'}`);
  console.log('━'.repeat(80));
  
  // Address
  console.log(`Address: ${address}`);
  console.log('━'.repeat(80));
  
  // SOL Balance
  console.log(`SOL Balance: ${solBalance.toFixed(6)} SOL`);
  
  // Token Balance (if applicable)
  if (tokenBalance) {
    console.log('━'.repeat(80));
    console.log(`Token Information:`);
    console.log(`Mint Address: ${tokenBalance.mintAddress}`);
    console.log(`Balance: ${tokenBalance.balance}`);
    console.log(`Associated Token Accounts: ${tokenBalance.accountsCount}`);
    console.log(`Token Type: ${tokenBalance.tokenType}`);
  }
  
  console.log('━'.repeat(80));
};

// Main function to execute balance command
export const executeBalance = async (
  rpcUrl: string,
  address: string,
  mintAddress?: string
): Promise<void> => {
  try {
    // Connect to the Solana cluster
    logger.info(`Connecting to Solana network at ${rpcUrl}`);
    const connection = new Connection(rpcUrl);
    
    // Validate the address
    try {
      new PublicKey(address);
    } catch (error) {
      logger.error(`Invalid Solana address: ${address}`);
      return;
    }
    
    // Validate the mint address if provided
    if (mintAddress) {
      try {
        new PublicKey(mintAddress);
      } catch (error) {
        logger.error(`Invalid mint address: ${mintAddress}`);
        return;
      }
    }
    
    // Query SOL balance
    logger.info(`Querying SOL balance for address: ${address}`);
    const solBalance = await querySolBalance(connection, address);
    
    // Token balance information (if mint is provided)
    let tokenBalanceInfo;
    
    if (mintAddress) {
      logger.info(`Querying token balance for mint: ${mintAddress}`);
      const tokenInfo = await queryTokenBalance(connection, address, mintAddress);
      
      tokenBalanceInfo = {
        balance: tokenInfo.balance,
        accountsCount: tokenInfo.accountsCount,
        tokenType: tokenInfo.tokenType,
        mintAddress
      };
    }
    
    // Display the results
    displayBalanceResults(address, solBalance, tokenBalanceInfo);
    
  } catch (error) {
    logger.error(`Error executing balance command: ${error}`);
  }
};
