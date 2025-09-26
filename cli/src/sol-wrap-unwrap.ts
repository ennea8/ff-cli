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
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  createAssociatedTokenAccountInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import fs from 'fs';
import { logger } from './utils';
import { getTokenProgramInfo, executeAtomicTokenTransfer } from './utils.token';
import { readWalletsFromCSV, WalletInfo } from './utils.wallet';
import bs58 from 'bs58';

// Constants
const DEFAULT_MIN_SOL_BALANCE = 0.02; // Default minimum SOL balance to keep when wrapping SOL

// Interface for wrap/unwrap options
export interface WrapUnwrapOptions {
  dryRun?: boolean;
  minSolBalance?: number;  // Minimum SOL balance to keep (in SOL)
  amount?: number;         // Amount to wrap/unwrap (in SOL)
  walletPath?: string;     // Path to 3-column format wallet file
}

// Interface to hold wallet key data from various sources
interface WalletKeyData {
  keypair: Keypair;
  publicKey: PublicKey;
}

/**
 * Get wallet key data from different sources (keyfile or base58 string)
 */
const getWalletKeyData = (
  keyFile?: string,
  keyBs58?: string
): WalletKeyData => {
  let keypair: Keypair;

  if (keyFile) {
    // Load keypair from array format file
    try {
      const keyData = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      keypair = Keypair.fromSecretKey(Uint8Array.from(keyData));
    } catch (error) {
      logger.error(`Failed to load keypair from file: ${error}`);
      throw error;
    }
  } else if (keyBs58) {
    // Load keypair from base58 encoded string
    try {
      const decodedKey = bs58.decode(keyBs58);
      keypair = Keypair.fromSecretKey(decodedKey);
    } catch (error) {
      logger.error(`Failed to decode base58 key: ${error}`);
      throw error;
    }
  } else {
    throw new Error("Either keyFile or keyBs58 must be provided");
  }

  return {
    keypair,
    publicKey: keypair.publicKey
  };
};

/**
 * Wrap SOL to wSOL
 */
export const wrapSol = async (
  connection: Connection,
  wallet: Keypair,
  amount: number | undefined,
  minSolBalance: number = DEFAULT_MIN_SOL_BALANCE,
): Promise<string> => {
  // Get the associated token account for wSOL
  const associatedTokenAddress = await getAssociatedTokenAddress(
    NATIVE_MINT,
    wallet.publicKey
  );

  // Check if the token account already exists
  let accountInfo = await connection.getAccountInfo(associatedTokenAddress);
  let wsolAccount;
  let accountExists = accountInfo !== null;

  // Get current SOL balance
  const solBalance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
  logger.info(`Current SOL balance: ${solBalance.toFixed(9)} SOL`);
  
  // Calculate amount to wrap
  let amountToWrap = amount;
  if (!amountToWrap || amountToWrap <= 0) {
    // If amount is not specified, wrap all SOL except minSolBalance
    amountToWrap = Math.max(0, solBalance - minSolBalance);
    logger.info(`No amount specified, wrapping ${amountToWrap.toFixed(9)} SOL (keeping ${minSolBalance} SOL)`);
  } else {
    // Check if we have enough SOL (considering minSolBalance)
    if (solBalance < amountToWrap + minSolBalance) {
      throw new Error(
        `Insufficient SOL balance. Have ${solBalance.toFixed(9)} SOL, need ${amountToWrap + minSolBalance} SOL (including ${minSolBalance} SOL minimum balance)`
      );
    }
  }

  if (amountToWrap <= 0) {
    logger.warn("Amount to wrap is zero or negative, nothing to do");
    return "No action taken";
  }

  logger.info(`Wrapping ${amountToWrap.toFixed(9)} SOL to wSOL`);

  // Create a transaction to wrap SOL
  const transaction = new Transaction();

  // If account doesn't exist, add instruction to create it
  if (!accountExists) {
    logger.info("Creating associated token account for wSOL");
    // Add create associated token account instruction
    transaction.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey, // Payer
        associatedTokenAddress, // Associated token account
        wallet.publicKey, // Owner
        NATIVE_MINT // Mint
      )
    );
  }

  // Add transfer SOL instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: associatedTokenAddress,
      lamports: amountToWrap * LAMPORTS_PER_SOL,
    })
  );
  
  // Then sync the native account to update its balance as wSOL
  transaction.add(
    createSyncNativeInstruction(
      associatedTokenAddress
    )
  );

  // Execute the transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet]
  );

  logger.info(`SOL wrapped successfully! Signature: ${signature}`);
  return signature;
};

/**
 * Unwrap wSOL to SOL
 */
export const unwrapSol = async (
  connection: Connection,
  wallet: Keypair,
  amount: number | undefined
): Promise<string> => {
  // Get the associated token account for wSOL
  const associatedTokenAddress = await getAssociatedTokenAddress(
    NATIVE_MINT,
    wallet.publicKey
  );

  // Check if the token account exists
  let accountInfo;
  try {
    accountInfo = await connection.getParsedAccountInfo(associatedTokenAddress);
    if (!accountInfo.value) {
      throw new Error("wSOL account not found");
    }
  } catch (error) {
    logger.error(`Error checking wSOL account: ${error}`);
    throw new Error("No wSOL account found for this wallet");
  }

  // Get wSOL balance and decimals
  const tokenInfo = await getTokenProgramInfo(connection, NATIVE_MINT.toString());
  const { decimals } = tokenInfo;

  // Get wSOL account data
  const tokenAccountInfo = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    NATIVE_MINT,
    wallet.publicKey
  );
  
  const wsolBalance = Number(tokenAccountInfo.amount) / Math.pow(10, decimals);
  logger.info(`Current wSOL balance: ${wsolBalance.toFixed(decimals)} wSOL`);

  // If no amount specified or amount > balance, unwrap all
  let amountToUnwrap = amount || wsolBalance;
  if (amountToUnwrap > wsolBalance) {
    logger.warn(`Requested amount (${amountToUnwrap}) is greater than available balance (${wsolBalance}). Unwrapping all.`);
    amountToUnwrap = wsolBalance;
  }

  if (amountToUnwrap <= 0) {
    logger.warn("Amount to unwrap is zero or negative, nothing to do");
    return "No action taken";
  }

  logger.info(`Unwrapping ${amountToUnwrap.toFixed(decimals)} wSOL to SOL`);

  // Create a transaction
  const transaction = new Transaction();

  // If unwrapping all, close the account
  if (amountToUnwrap >= wsolBalance) {
    // Add sync native instruction to update the wSOL account balance
    transaction.add(
      createSyncNativeInstruction(
        tokenAccountInfo.address
      )
    );

    // Add close account instruction to unwrap and close the wSOL account
    transaction.add(
      createCloseAccountInstruction(
        tokenAccountInfo.address,      // Token account to close
        wallet.publicKey,              // Destination for lamports
        wallet.publicKey,              // Owner of the token account
        [],                            // Multisigners
        TOKEN_PROGRAM_ID               // Token program
      )
    );
  } else {
    // TODO: Partial unwrapping not implemented yet
    // For now, we'll unwrap all
    logger.warn("Partial unwrapping not supported yet, unwrapping all wSOL");
    
    transaction.add(
      createSyncNativeInstruction(
        tokenAccountInfo.address
      )
    );
    
    transaction.add(
      createCloseAccountInstruction(
        tokenAccountInfo.address,
        wallet.publicKey,
        wallet.publicKey,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  // Execute the transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet]
  );

  logger.info(`wSOL unwrapped successfully! Signature: ${signature}`);
  return signature;
};

/**
 * Process batch wrap or unwrap for multiple wallets from a CSV file
 */
export const processBatchWrapUnwrap = async (
  connection: Connection,
  walletPath: string,
  isWrap: boolean,
  minSolBalance: number = DEFAULT_MIN_SOL_BALANCE
): Promise<void> => {
  // Read wallets from CSV file
  const wallets = readWalletsFromCSV(walletPath);
  
  logger.info(`Loaded ${wallets.length} wallets from ${walletPath}`);
  logger.info(`Will ${isWrap ? 'wrap SOL to wSOL' : 'unwrap wSOL to SOL'} for all wallets`);
  
  if (isWrap) {
    logger.info(`Keeping minimum balance of ${minSolBalance} SOL in each wallet`);
  }

  // Process each wallet
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const keypair = Keypair.fromSecretKey(bs58.decode(wallet.base58Key));
    
    logger.info(`Processing wallet ${i+1}/${wallets.length}: ${wallet.address}`);
    
    try {
      if (isWrap) {
        // Wrap SOL to wSOL (amount=undefined means wrap all except minSolBalance)
        await wrapSol(connection, keypair, undefined, minSolBalance);
      } else {
        // Unwrap wSOL to SOL (amount=undefined means unwrap all)
        await unwrapSol(connection, keypair, undefined);
      }
    } catch (error) {
      logger.error(`Failed to process wallet ${wallet.address}: ${error}`);
      // Continue with next wallet
    }
  }

  logger.info(`Batch ${isWrap ? 'wrap' : 'unwrap'} completed for ${wallets.length} wallets`);
};

/**
 * Main function to execute SOL wrap command
 */
export const executeWrapSol = async (
  rpcUrl: string,
  keyFile: string | undefined,
  keyBs58: string | undefined,
  options: WrapUnwrapOptions
): Promise<void> => {
  const connection = new Connection(rpcUrl);
  
  // Check if we're processing a batch of wallets
  if (options.walletPath) {
    await processBatchWrapUnwrap(
      connection,
      options.walletPath,
      true, // isWrap = true
      options.minSolBalance || DEFAULT_MIN_SOL_BALANCE
    );
    return;
  }

  // Single wallet processing
  const { keypair, publicKey } = getWalletKeyData(keyFile, keyBs58);
  logger.info(`Wrapping SOL to wSOL for wallet: ${publicKey.toString()}`);

  await wrapSol(
    connection,
    keypair,
    options.amount,
    options.minSolBalance || DEFAULT_MIN_SOL_BALANCE
  );
};

/**
 * Main function to execute SOL unwrap command
 */
export const executeUnwrapSol = async (
  rpcUrl: string,
  keyFile: string | undefined,
  keyBs58: string | undefined,
  options: WrapUnwrapOptions
): Promise<void> => {
  const connection = new Connection(rpcUrl);
  
  // Check if we're processing a batch of wallets
  if (options.walletPath) {
    await processBatchWrapUnwrap(
      connection,
      options.walletPath,
      false, // isWrap = false
      options.minSolBalance || DEFAULT_MIN_SOL_BALANCE
    );
    return;
  }

  // Single wallet processing
  const { keypair, publicKey } = getWalletKeyData(keyFile, keyBs58);
  logger.info(`Unwrapping wSOL to SOL for wallet: ${publicKey.toString()}`);

  await unwrapSol(
    connection,
    keypair,
    options.amount
  );
};

/**
 * Combined function for both wrap and unwrap operations
 */
export const executeSolWrapping = async (
  rpcUrl: string,
  action: 'wrap' | 'unwrap',
  keyFile: string | undefined,
  keyBs58: string | undefined,
  options: WrapUnwrapOptions
): Promise<void> => {
  if (action === 'wrap') {
    await executeWrapSol(rpcUrl, keyFile, keyBs58, options);
  } else {
    await executeUnwrapSol(rpcUrl, keyFile, keyBs58, options);
  }
};
