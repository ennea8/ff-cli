import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import { logger } from './utils';

/**
 * Safely convert decimal amount to integer units (lamports/token units)
 * Avoids floating-point precision issues by using string manipulation
 */
export const convertToRawAmount = (amount: number, decimals: number): bigint => {
  // Convert to string to avoid floating-point issues
  const amountStr = amount.toString();
  const [integerPart, decimalPart = ''] = amountStr.split('.');
  
  // Pad or truncate decimal part to match required decimals
  const paddedDecimalPart = decimalPart.padEnd(decimals, '0').substring(0, decimals);
  
  // Combine integer and decimal parts
  const rawAmountStr = integerPart + paddedDecimalPart;
  
  return BigInt(rawAmountStr);
};

/**
 * Safely convert SOL amount to lamports using the unified conversion function
 * SOL has 9 decimals (LAMPORTS_PER_SOL = 10^9)
 */
export const convertSolToLamports = (amountInSol: number): bigint => {
  return convertToRawAmount(amountInSol, 9);
};

// Interface for token program info
export interface TokenProgramInfo {
  programId: PublicKey;
  decimals: number;
  isToken2022: boolean;
}

// Interface for token transfer parameters
export interface TokenTransferParams {
  connection: Connection;
  fromKeypair: Keypair;
  toAddress: string;
  mintAddress: string;
  amount: number;
}

// Interface for token transfer result
export interface TokenTransferResult {
  signature: string;
  accountCreated: boolean;
  tokenProgram: string;
  decimals: number;
}

/**
 * Determine token program and get mint information
 */
export const getTokenProgramInfo = async (
  connection: Connection,
  mintAddress: string
): Promise<TokenProgramInfo> => {
  const mint = new PublicKey(mintAddress);
  let programId = TOKEN_PROGRAM_ID;
  let decimals = 9; // Default decimals
  let isToken2022 = false;
  
  try {
    // Check if this is a Token-2022 mint
    const mintInfo = await connection.getAccountInfo(mint);
    if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      programId = TOKEN_2022_PROGRAM_ID;
      isToken2022 = true;
      logger.info(`Detected Token-2022 mint: ${mintAddress}`);
    }
    
    // Get mint decimals using parsed account info
    const parsedMintInfo = await connection.getParsedAccountInfo(mint);
    if (parsedMintInfo.value?.data && 'parsed' in parsedMintInfo.value.data) {
      decimals = parsedMintInfo.value.data.parsed.info.decimals;
    }
  } catch (error) {
    logger.warn(`Could not determine token program for ${mintAddress}, using default SPL Token: ${error}`);
  }
  
  return {
    programId,
    decimals,
    isToken2022
  };
};

/**
 * Execute atomic token transfer (account creation + transfer in single transaction)
 * This is the best practice approach for token transfers
 */
export const executeAtomicTokenTransfer = async (
  params: TokenTransferParams
): Promise<TokenTransferResult> => {
  const { connection, fromKeypair, toAddress, mintAddress, amount } = params;
  
  try {
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(toAddress);

    // Get token program info
    const tokenInfo = await getTokenProgramInfo(connection, mintAddress);
    const { programId: tokenProgramId, decimals } = tokenInfo;

    // Get sender's token account
    logger.info(`Getting sender token account for ${mintAddress.substring(0, 8)}...`);
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromKeypair,
      mint,
      fromKeypair.publicKey,
      false,
      undefined,
      undefined,
      tokenProgramId
    );

    // Get recipient token address
    const recipientTokenAddress = await getAssociatedTokenAddress(
      mint,
      recipient,
      false,
      tokenProgramId
    );
    
    // Check if recipient token account exists
    const accountInfo = await connection.getAccountInfo(recipientTokenAddress);
    const accountExists = accountInfo !== null;
    
    // Create transaction
    const transaction = new Transaction();
    
    // Add account creation instruction if needed
    if (!accountExists) {
      logger.info(`Creating token account for ${toAddress.substring(0, 8)}...`);
      const createAccountIx = createAssociatedTokenAccountInstruction(
        fromKeypair.publicKey,  // Payer
        recipientTokenAddress,  // Associated token account address
        recipient,              // Owner
        mint,                   // Mint
        tokenProgramId          // Token program
      );
      transaction.add(createAccountIx);
    }
    
    // Add transfer instruction
    const rawAmount = convertToRawAmount(amount, decimals);

    logger.info(`createTransferInstruction rawAmount: ${rawAmount}`)
    const transferIx = createTransferInstruction(
      senderTokenAccount.address,
      recipientTokenAddress,
      fromKeypair.publicKey,
      rawAmount,
      [],
      tokenProgramId
    );
    transaction.add(transferIx);
    
    // Send and confirm transaction
    logger.info(`Executing ${accountExists ? 'transfer' : 'account creation + transfer'} transaction...`);
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [fromKeypair]
    );
    
    return {
      signature,
      accountCreated: !accountExists,
      tokenProgram: tokenProgramId.toString(),
      decimals
    };
  } catch (error) {
    logger.error(`Failed to execute token transfer from ${fromKeypair.publicKey.toString()} to ${toAddress}: ${error}`);
    throw error;
  }
};

/**
 * Legacy method using high-level transfer function (less optimal)
 * Kept for compatibility but not recommended for new code
 */
export const executeLegacyTokenTransfer = async (
  params: TokenTransferParams
): Promise<string> => {
  const { connection, fromKeypair, toAddress, mintAddress, amount } = params;
  
  const mint = new PublicKey(mintAddress);
  const recipient = new PublicKey(toAddress);
  
  // Get token program info
  const tokenInfo = await getTokenProgramInfo(connection, mintAddress);
  const { programId: tokenProgramId, decimals } = tokenInfo;
  
  // Import transfer function dynamically to avoid issues
  const { transfer } = await import('@solana/spl-token');
  
  // Get or create token accounts
  const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    fromKeypair,
    mint,
    fromKeypair.publicKey,
    false,
    undefined,
    undefined,
    tokenProgramId
  );
  
  const toTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    fromKeypair,
    mint,
    recipient,
    false,
    undefined,
    undefined,
    tokenProgramId
  );
  
  // Execute transfer
  const rawAmount = convertToRawAmount(amount, decimals);
  const signature = await transfer(
    connection,
    fromKeypair,
    fromTokenAccount.address,
    toTokenAccount.address,
    fromKeypair,
    rawAmount,
    [],
    undefined,
    tokenProgramId
  );
  
  return signature;
};
