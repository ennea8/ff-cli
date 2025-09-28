import fs from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  Account,
  NATIVE_MINT,
} from '@solana/spl-token';
import { logger, logTransaction, logImportant } from './utils';
import { executeAtomicTokenTransfer, getTokenProgramInfo } from './utils.token';
import bs58 from 'bs58';

// Helper function to generate timestamp for file names
const getCurrentTimestamp = (): string => {
  const now = new Date();
  return now.toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
};

// WSOL mint address (Wrapped SOL)
const WSOL_MINT = NATIVE_MINT;

// Interface for discovered token account
interface TokenAccountInfo {
  mint: string;
  address: string;
  amount: string;
  decimals: number;
  programId: string;
  isWSol: boolean;
  rentLamports: number;
}

// Interface for wallet assets
interface WalletAssets {
  solBalance: number;
  tokenAccounts: TokenAccountInfo[];
  totalRentReclaim: number;
}

// Interface for drain operation result
interface DrainResult {
  success: boolean;
  transferredAssets: {
    sol: number;
    tokens: { mint: string; amount: string; }[];
  };
  closedAccounts: number;
  reclaimedRent: number;
  finalBalance: number;
  errors: string[];
}

/**
 * Discover all assets in a wallet including SOL and all token accounts
 */
export const discoverWalletAssets = async (
  connection: Connection,
  walletAddress: string
): Promise<WalletAssets> => {
  const publicKey = new PublicKey(walletAddress);
  
  logger.info(`Discovering assets for wallet: ${walletAddress}`);
  
  // Get SOL balance
  const solBalance = await connection.getBalance(publicKey);
  logger.info(`SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
  
  // Get all token accounts
  const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
    programId: TOKEN_PROGRAM_ID,
  });
  
  // Get Token-2022 accounts
  const token2022Accounts = await connection.getTokenAccountsByOwner(publicKey, {
    programId: TOKEN_2022_PROGRAM_ID,
  });
  
  const allTokenAccounts = [...tokenAccounts.value, ...token2022Accounts.value];
  logger.info(`Found ${allTokenAccounts.length} token accounts`);
  
  const tokenAccountInfos: TokenAccountInfo[] = [];
  let totalRentReclaim = 0;
  
  for (const tokenAccount of allTokenAccounts) {
    try {
      const accountInfo = await getAccount(connection, tokenAccount.pubkey);
      
      if (accountInfo && accountInfo.amount > BigInt(0)) {
        // Get mint info to determine decimals
        const tokenInfo = await getTokenProgramInfo(connection, accountInfo.mint.toString());
        
        const isWSol = accountInfo.mint.equals(WSOL_MINT);
        const rentLamports = tokenAccount.account.lamports;
        
        tokenAccountInfos.push({
          mint: accountInfo.mint.toString(),
          address: tokenAccount.pubkey.toString(),
          amount: accountInfo.amount.toString(),
          decimals: tokenInfo.decimals,
          programId: tokenInfo.programId.toString(),
          isWSol,
          rentLamports,
        });
        
        totalRentReclaim += rentLamports;
        
        const displayAmount = Number(accountInfo.amount) / Math.pow(10, tokenInfo.decimals);
        logger.info(`Token account ${tokenAccount.pubkey.toString().substring(0, 8)}...: ${displayAmount} ${isWSol ? 'WSOL' : 'tokens'} (${accountInfo.mint.toString().substring(0, 8)}...)`);
      }
    } catch (error) {
      logger.warn(`Failed to get info for token account ${tokenAccount.pubkey.toString()}: ${error}`);
    }
  }
  
  return {
    solBalance: solBalance / LAMPORTS_PER_SOL,
    tokenAccounts: tokenAccountInfos,
    totalRentReclaim: totalRentReclaim / LAMPORTS_PER_SOL,
  };
};

/**
 * Unwrap WSOL back to native SOL
 */
const unwrapWSol = async (
  connection: Connection,
  walletKeypair: Keypair,
  wsolAccount: TokenAccountInfo
): Promise<string> => {
  logger.info(`Unwrapping ${Number(wsolAccount.amount) / Math.pow(10, wsolAccount.decimals)} WSOL to SOL`);
  
  const transaction = new Transaction();
  
  // Add sync native instruction to update the WSOL account balance
  transaction.add(
    createSyncNativeInstruction(
      new PublicKey(wsolAccount.address)
    )
  );
  
  // Add close account instruction to unwrap and close the WSOL account
  transaction.add(
    createCloseAccountInstruction(
      new PublicKey(wsolAccount.address),     // Token account to close
      walletKeypair.publicKey,               // Destination for lamports
      walletKeypair.publicKey,               // Owner of the token account
      [],                                    // Multisigners
      new PublicKey(wsolAccount.programId)   // Token program
    )
  );
  
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [walletKeypair]
  );
  
  logger.info(`WSOL unwrapped successfully: ${signature}`);
  return signature;
};

/**
 * Transfer all tokens to destination wallet
 */
const transferAllTokens = async (
  connection: Connection,
  sourceKeypair: Keypair,
  destinationAddress: string,
  tokenAccounts: TokenAccountInfo[]
): Promise<{ transferred: TokenAccountInfo[]; errors: string[] }> => {
  const transferred: TokenAccountInfo[] = [];
  const errors: string[] = [];
  
  logger.info(`Transferring ${tokenAccounts.length} token types to ${destinationAddress}`);
  
  // Check current SOL balance before attempting token transfers
  const currentBalance = await connection.getBalance(sourceKeypair.publicKey);
  const currentSol = currentBalance / LAMPORTS_PER_SOL;
  
  // Check if we need to create recipient token accounts
  const destinationPubkey = new PublicKey(destinationAddress);
  const recipientATACheckPromises = tokenAccounts.filter(acc => !acc.isWSol).map(async (tokenAccount) => {
    const mint = new PublicKey(tokenAccount.mint);
    const tokenProgramId = new PublicKey(tokenAccount.programId);
    const recipientTokenAddress = await getAssociatedTokenAddress(
      mint,
      destinationPubkey,
      false,
      tokenProgramId
    );
    const accountInfo = await connection.getAccountInfo(recipientTokenAddress);
    return {
      mint: tokenAccount.mint,
      needsATA: accountInfo === null,
    };
  });
  
  const recipientATAResults = await Promise.all(recipientATACheckPromises);
  const atasToCreate = recipientATAResults.filter(r => r.needsATA).length;
  
  // Estimate minimum SOL needed for ATA creation
  // Each ATA costs approximately 0.00203928 SOL on mainnet/devnet
  const estimatedRentPerATA = 0.00203928;
  const estimatedATACreationCost = atasToCreate * estimatedRentPerATA;
  
  // Plus transaction fees for the transfers
  const estimatedTxFees = tokenAccounts.length * 0.00001;
  const totalEstimatedCost = estimatedATACreationCost + estimatedTxFees;
  
  // Larger safety buffer to handle network conditions
  const safetyBuffer = 0.001; // 1,000,000 lamports (much more conservative)
  const minimumSolNeeded = Math.max(totalEstimatedCost + safetyBuffer, 0.002); // Minimum 0.002 SOL required
  
  if (currentSol < minimumSolNeeded) {
    const errorMsg = `Insufficient SOL balance (${currentSol.toFixed(6)} SOL) to cover token transfers. ` +
      `Estimated need: ${minimumSolNeeded.toFixed(6)} SOL (${atasToCreate} ATAs to create, cost: ~${estimatedATACreationCost.toFixed(6)} SOL + fees)`;
    logger.error(errorMsg);
    errors.push(errorMsg);
    
    // Return early if we know there's not enough SOL
    return { transferred, errors };
  }
  
  // Log ATA creation information
  if (atasToCreate > 0) {
    logger.info(`Will create ${atasToCreate} Associated Token Accounts for recipient with estimated cost of ~${estimatedATACreationCost.toFixed(6)} SOL`);
  }
  
  for (const tokenAccount of tokenAccounts) {
    if (tokenAccount.isWSol) {
      // Skip WSOL here, we'll handle it separately
      continue;
    }
    
    try {
      const amount = Number(tokenAccount.amount) / Math.pow(10, tokenAccount.decimals);
      
      logger.info(`Transferring ${amount} tokens from mint ${tokenAccount.mint.substring(0, 8)}...`);
      
      const result = await executeAtomicTokenTransfer({
        connection,
        fromKeypair: sourceKeypair,
        toAddress: destinationAddress,
        mintAddress: tokenAccount.mint,
        amount,
      });
      
      logger.info(`Token transfer successful: ${result.signature}`);
      transferred.push(tokenAccount);
      
    } catch (error) {
      const errorMsg = `Failed to transfer tokens from mint ${tokenAccount.mint}: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
    }
  }
  
  return { transferred, errors };
};

/**
 * Close empty token accounts and reclaim rent
 */
const closeTokenAccounts = async (
  connection: Connection,
  walletKeypair: Keypair,
  tokenAccounts: TokenAccountInfo[]
): Promise<{ closed: number; reclaimedRent: number; errors: string[] }> => {
  let closed = 0;
  let reclaimedRent = 0;
  const errors: string[] = [];
  
  logger.info(`Closing ${tokenAccounts.length} token accounts to reclaim rent`);
  
  for (const tokenAccount of tokenAccounts) {
    try {
      const transaction = new Transaction();
      
      transaction.add(
        createCloseAccountInstruction(
          new PublicKey(tokenAccount.address),     // Token account to close
          walletKeypair.publicKey,               // Destination for lamports (rent reclaim)
          walletKeypair.publicKey,               // Owner of the token account
          [],                                    // Multisigners
          new PublicKey(tokenAccount.programId)  // Token program
        )
      );
      
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [walletKeypair]
      );
      
      closed++;
      reclaimedRent += tokenAccount.rentLamports / LAMPORTS_PER_SOL;
      
      logger.info(`Closed token account ${tokenAccount.address.substring(0, 8)}..., reclaimed ${tokenAccount.rentLamports / LAMPORTS_PER_SOL} SOL rent: ${signature}`);
      
    } catch (error) {
      const errorMsg = `Failed to close token account ${tokenAccount.address}: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
    }
  }
  
  return { closed, reclaimedRent, errors };
};

/**
 * Transfer remaining SOL to destination
 */
const transferRemainingSol = async (
  connection: Connection,
  sourceKeypair: Keypair,
  destinationAddress: string,
  keepAmount: number = 0
): Promise<{ transferred: number; signature: string | null }> => {
  const currentBalance = await connection.getBalance(sourceKeypair.publicKey);
  const currentSol = currentBalance / LAMPORTS_PER_SOL;
  
  // Hard minimum SOL requirement to prevent insufficient funds errors
  const minRequiredSol = 0.002; // 2,000,000 lamports
  if (currentSol < minRequiredSol) {
    logger.warn(`SOL balance (${currentSol.toFixed(6)} SOL) is too low to safely perform transfer. Minimum recommended: ${minRequiredSol} SOL`);
    return { transferred: 0, signature: null };
  }
  
  // Create a transaction to estimate fees
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sourceKeypair.publicKey,
      toPubkey: new PublicKey(destinationAddress),
      lamports: 0, // Placeholder amount, will update after fee calculation
    })
  );

  // Get the recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = sourceKeypair.publicKey;

  // Calculate fee more precisely using getFeeForMessage
  let estimatedFee: number;
  try {
    // For @solana/web3.js >= 1.73.0, we can use getFeeForMessage
    const message = transaction.compileMessage();
    const feeResponse = await connection.getFeeForMessage(message, 'confirmed');
    
    // Check if fee calculation was successful
    if (feeResponse.value === null) {
      // Fall back to a safe estimate if fee calculation failed
      estimatedFee = 0.0001; // 100,000 lamports (conservative estimate)
      logger.warn(`Could not get exact fee, using safe estimate of ${estimatedFee} SOL`);
    } else {
      estimatedFee = feeResponse.value / LAMPORTS_PER_SOL;
      logger.info(`Calculated transaction fee: ${estimatedFee.toFixed(6)} SOL`);
    }
  } catch (error) {
    // Fall back to a conservative estimate if getFeeForMessage is not available or fails
    estimatedFee = 0.0001; // 100,000 lamports (conservative estimate)
    logger.warn(`Error calculating exact fee, using safe estimate of ${estimatedFee} SOL: ${error}`);
  }
  
  // Add a larger safety buffer to the fee to handle network fluctuations and rent requirements
  const safetyBuffer = 0.001; // 1,000,000 lamports (much more conservative)
  const totalFee = estimatedFee + safetyBuffer;
  
  // Calculate transfer amount
  const transferAmount = currentSol - keepAmount - totalFee;
  
  if (transferAmount <= 0) {
    logger.warn(`Insufficient SOL to transfer after keeping ${keepAmount} SOL and accounting for fees (${totalFee.toFixed(6)} SOL)`);
    return { transferred: 0, signature: null };
  }
  
  // Set a minimum practical transfer amount to avoid dust transfers
  const minTransferAmount = 0.000001; // 1,000 lamports
  if (transferAmount < minTransferAmount) {
    logger.warn(`Calculated transfer amount (${transferAmount.toFixed(9)} SOL) is below minimum practical amount (${minTransferAmount} SOL). Skipping transfer.`);
    return { transferred: 0, signature: null };
  }
  
  // Update the transaction with the calculated amount
  transaction.instructions[0] = SystemProgram.transfer({
    fromPubkey: sourceKeypair.publicKey,
    toPubkey: new PublicKey(destinationAddress),
    lamports: Math.floor(transferAmount * LAMPORTS_PER_SOL),
  });
  
  logger.info(`Transferring ${transferAmount.toFixed(9)} SOL to ${destinationAddress} (keeping ${keepAmount} SOL plus ${totalFee.toFixed(6)} SOL for fees)`);
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sourceKeypair]
    );
    
    logger.info(`SOL transfer successful: ${signature}`);
    return { transferred: transferAmount, signature };
    
  } catch (error) {
    logger.error(`Failed to transfer SOL: ${error}`);
    throw error;
  }
};

/**
 * Main function to drain all assets from a wallet
 */
export const executeDrainWallet = async (
  rpcUrl: string | undefined,
  sourceKeypairPath: string | undefined,
  sourceKeyBs58: string | undefined,
  destinationAddress: string,
  options: {
    dryRun?: boolean;
    closeAccounts?: boolean;
    reclaimRent?: boolean;
    keepSol?: number;
    tokens?: string[];
    excludeTokens?: string[];
    minBalance?: number;
  } = {}
): Promise<DrainResult> => {
  const {
    dryRun = false,
    closeAccounts = true,
    reclaimRent = true,
    keepSol = 0,
    tokens,
    excludeTokens,
    minBalance = 0,
  } = options;
  
  try {
    // Initialize connection
    const connection = new Connection(rpcUrl || 'https://api.mainnet-beta.solana.com', 'confirmed');
    
    // Load source keypair from either file or base58 string
    let sourceKeypair: Keypair;
    if (sourceKeypairPath) {
      // Load from file (array format)
      logger.info(`Loading keypair from file: ${sourceKeypairPath}`);
      const keypairData = JSON.parse(fs.readFileSync(sourceKeypairPath, 'utf8'));
      sourceKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    } else if (sourceKeyBs58) {
      // Load from base58 string
      logger.info('Loading keypair from base58 string');
      const secretKeyBytes = bs58.decode(sourceKeyBs58);
      sourceKeypair = Keypair.fromSecretKey(secretKeyBytes);
    } else {
      throw new Error('Either sourceKeypairPath or sourceKeyBs58 must be provided');
    }
    
    logger.info('='.repeat(50));
    logger.info('WALLET DRAIN OPERATION STARTED');
    logger.info('='.repeat(50));
    
    logger.info(`Source wallet: ${sourceKeypair.publicKey.toString()}`);
    logger.info(`Destination wallet: ${destinationAddress}`);
    logger.info(`Dry run mode: ${dryRun ? 'YES' : 'NO'}`);
    logger.info(`Close accounts: ${closeAccounts ? 'YES' : 'NO'}`);
    logger.info(`Reclaim rent: ${reclaimRent ? 'YES' : 'NO'}`);
    logger.info(`Keep SOL amount: ${keepSol}`);
    
    // Discover wallet assets
    const assets = await discoverWalletAssets(connection, sourceKeypair.publicKey.toString());
    
    // Validate if keepSol amount is feasible with current balance
    if (keepSol > 0 && keepSol > assets.solBalance) {
      logger.warn(`Keep SOL amount (${keepSol}) exceeds current wallet balance (${assets.solBalance.toFixed(6)} SOL)`);
      
      if (!dryRun) {
        throw new Error(`Keep SOL amount (${keepSol}) exceeds current wallet balance (${assets.solBalance.toFixed(6)} SOL)`);
      }
    }
    
    // If total SOL balance is too low, warn about potential issues
    if (assets.solBalance < 0.002) {
      logger.warn(`WARNING: SOL balance (${assets.solBalance.toFixed(6)}) is very low and may be insufficient for transaction fees and rent requirements`);
    }
    
    // Filter token accounts based on options
    let filteredTokenAccounts = assets.tokenAccounts;
    
    if (tokens && tokens.length > 0) {
      filteredTokenAccounts = filteredTokenAccounts.filter(acc => tokens.includes(acc.mint));
      logger.info(`Filtered to specific tokens: ${tokens.length} mints`);
    }
    
    if (excludeTokens && excludeTokens.length > 0) {
      filteredTokenAccounts = filteredTokenAccounts.filter(acc => !excludeTokens.includes(acc.mint));
      logger.info(`Excluded tokens: ${excludeTokens.length} mints`);
    }
    
    if (minBalance > 0) {
      filteredTokenAccounts = filteredTokenAccounts.filter(acc => {
        const balance = Number(acc.amount) / Math.pow(10, acc.decimals);
        return balance >= minBalance;
      });
      logger.info(`Filtered by minimum balance ${minBalance}: ${filteredTokenAccounts.length} accounts remaining`);
    }
    
    // Display preview
    logger.info('\n' + '='.repeat(30) + ' OPERATION PREVIEW ' + '='.repeat(30));
    logger.info(`Total SOL balance: ${assets.solBalance} SOL`);
    logger.info(`Token accounts to process: ${filteredTokenAccounts.length}`);
    logger.info(`Estimated rent to reclaim: ${assets.totalRentReclaim} SOL`);
    logger.info(`Estimated net SOL gain from rent: +${assets.totalRentReclaim - (filteredTokenAccounts.length * 0.000005)} SOL`);
    
    filteredTokenAccounts.forEach((acc, i) => {
      const balance = Number(acc.amount) / Math.pow(10, acc.decimals);
      logger.info(`  ${i + 1}. ${acc.isWSol ? 'WSOL' : 'Token'} ${acc.mint.substring(0, 8)}...: ${balance} (rent: ${acc.rentLamports / LAMPORTS_PER_SOL} SOL)`);
    });
    
    if (dryRun) {
      logger.info('\n' + '='.repeat(20) + ' DRY RUN COMPLETED - NO ACTUAL TRANSFERS ' + '='.repeat(20));
      return {
        success: true,
        transferredAssets: { sol: 0, tokens: [] },
        closedAccounts: 0,
        reclaimedRent: 0,
        finalBalance: assets.solBalance,
        errors: [],
      };
    }
    
    const result: DrainResult = {
      success: true,
      transferredAssets: { sol: 0, tokens: [] },
      closedAccounts: 0,
      reclaimedRent: 0,
      finalBalance: 0,
      errors: [],
    };
    
    // Step 1: Handle WSOL unwrapping
    const wsolAccounts = filteredTokenAccounts.filter(acc => acc.isWSol);
    for (const wsolAccount of wsolAccounts) {
      try {
        await unwrapWSol(connection, sourceKeypair, wsolAccount);
        const wsolAmount = Number(wsolAccount.amount) / Math.pow(10, wsolAccount.decimals);
        result.transferredAssets.sol += wsolAmount;
        result.reclaimedRent += wsolAccount.rentLamports / LAMPORTS_PER_SOL;
      } catch (error) {
        result.errors.push(`Failed to unwrap WSOL: ${error}`);
      }
    }
    
    // Step 2: Transfer all non-WSOL tokens
    const nonWsolAccounts = filteredTokenAccounts.filter(acc => !acc.isWSol);
    const tokenTransferResult = await transferAllTokens(
      connection,
      sourceKeypair,
      destinationAddress,
      nonWsolAccounts
    );
    
    result.transferredAssets.tokens = tokenTransferResult.transferred.map(acc => ({
      mint: acc.mint,
      amount: (Number(acc.amount) / Math.pow(10, acc.decimals)).toString(),
    }));
    result.errors.push(...tokenTransferResult.errors);
    
    // Step 3: Close token accounts and reclaim rent
    if (closeAccounts && reclaimRent) {
      const closeResult = await closeTokenAccounts(
        connection,
        sourceKeypair,
        tokenTransferResult.transferred
      );
      
      result.closedAccounts = closeResult.closed;
      result.reclaimedRent += closeResult.reclaimedRent;
      result.errors.push(...closeResult.errors);
    }
    
    // Step 4: Transfer remaining SOL
    const solTransferResult = await transferRemainingSol(
      connection,
      sourceKeypair,
      destinationAddress,
      keepSol
    );
    
    result.transferredAssets.sol += solTransferResult.transferred;
    
    // Final balance check
    const finalBalance = await connection.getBalance(sourceKeypair.publicKey);
    result.finalBalance = finalBalance / LAMPORTS_PER_SOL;
    
    // Log results
    logger.info('\n' + '='.repeat(30) + ' OPERATION COMPLETED ' + '='.repeat(30));
    logger.info(`✓ Transferred ${result.transferredAssets.sol} SOL to destination`);
    logger.info(`✓ Transferred ${result.transferredAssets.tokens.length} token types to destination`);
    logger.info(`✓ Closed ${result.closedAccounts} token accounts`);
    logger.info(`✓ Reclaimed ${result.reclaimedRent} SOL in rent`);
    logger.info(`✓ Source wallet remaining balance: ${result.finalBalance} SOL`);
    
    if (result.errors.length > 0) {
      logger.warn(`⚠ ${result.errors.length} errors occurred during operation:`);
      result.errors.forEach(error => logger.warn(`  - ${error}`));
    }
    
    // Save results to CSV
    const timestamp = getCurrentTimestamp();
    const outDir = 'out';
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outputPath = `${outDir}/drain_wallet_${timestamp}.csv`;
    
    const csvContent = [
      'operation,asset_type,mint_address,amount,status,signature',
      ...result.transferredAssets.tokens.map(token => 
        `transfer,token,${token.mint},${token.amount},success,`
      ),
      `transfer,sol,,${result.transferredAssets.sol},success,`,
      `rent_reclaim,sol,,${result.reclaimedRent},success,`,
      `accounts_closed,count,,${result.closedAccounts},success,`,
    ].join('\n');
    
    fs.writeFileSync(outputPath, csvContent);
    logger.info(`Results saved to: ${outputPath}`);
    
    return result;
    
  } catch (error) {
    logger.error(`Drain wallet operation failed: ${error}`);
    throw error;
  }
};
