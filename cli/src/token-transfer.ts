import fs from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  TokenBalance,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { logger, getProgressFileName, saveProgress, loadProgress, readRecordsFromCSV, logTransaction, logImportant } from './utils';

// Interface for token recipient record from CSV
interface TokenRecipientRecord {
  address: string;
  amount: string;
  transferred?: boolean;
}

// Validate token recipient records from CSV
const validateTokenRecipient = (record: any, index: number): TokenRecipientRecord => {
  if (!record.address) {
    throw new Error(`Missing address in row ${index + 2}`);
  }
  if (!record.amount || isNaN(parseFloat(record.amount))) {
    throw new Error(`Invalid amount in row ${index + 2}`);
  }
  
  return {
    address: record.address,
    amount: record.amount,
    transferred: record.transferred || false,
  };
};

// Transfer tokens to a single address
const transferTokensToAddress = async (
  connection: Connection,
  sender: Keypair,
  recipientAddress: string,
  mintAddress: string,
  amount: number,
  logIdentifier: string // Added parameter for consistent logging
): Promise<string> => {
  try {
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(recipientAddress);

    // Step 1: Get the sender's token account
    logger.info(`Getting sender token account...`);
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      sender,
      mint,
      sender.publicKey
    );
    logger.info(`Sender token account: ${senderTokenAccount.address.toString()}`);

    // Step 2: Get the recipient token address
    const recipientTokenAddress = await getAssociatedTokenAddress(
      mint,
      recipient
    );
    logger.info(`Recipient token address: ${recipientTokenAddress.toString()}`);
    
    // Step 3: Check if recipient token account exists
    const accountInfo = await connection.getAccountInfo(recipientTokenAddress);
    const accountExists = accountInfo !== null;
    
    // Step 4: Create a transaction that will handle both account creation (if needed) and transfer
    logger.info(`Preparing token transfer of ${amount} tokens to ${recipientAddress}...`);
    
    // Create transaction
    const transaction = new Transaction();
    
    // If account doesn't exist, add instruction to create it
    if (!accountExists) {
      logger.info(`Recipient account does not exist, will create it in the same transaction`);
      const createAccountIx = createAssociatedTokenAccountInstruction(
        sender.publicKey,      // Payer
        recipientTokenAddress, // Associated token account address
        recipient,             // Owner
        mint                   // Mint
      );
      transaction.add(createAccountIx);
    } else {
      logger.info(`Token account already exists for ${recipientAddress}`);
    }
    
    // Add transfer instruction to the same transaction
    const transferIx = createTransferInstruction(
      senderTokenAccount.address,
      recipientTokenAddress,
      sender.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    );
    transaction.add(transferIx);
    
    // Send and confirm the combined transaction
    logger.info(`Sending combined transaction (${!accountExists ? 'create account + ' : ''}transfer)...`);
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sender]
    );
    
    // Use the consistent log identifier passed from the calling function
    logTransaction(
      logIdentifier,
      `Transaction confirmed`,
      signature,
      {
        type: 'token_transfer',
        sender: sender.publicKey.toString(),
        recipient: recipientAddress,
        amount: amount,
        mint: mintAddress,
        accountCreated: !accountExists
      }
    );
    
    return signature;
  } catch (error) {
    logger.error(`Failed to transfer tokens to ${recipientAddress}: ${error}`);
    throw error;
  }
};

// Execute token transfers in batches
export const executeTokenTransfer = async (
  rpc: string,
  keypairPath: string,
  receiversPath: string,
  mintAddress: string,
  batchSize: number
): Promise<void> => {
  // Ensure batch size is a valid number
  if (isNaN(batchSize) || batchSize <= 0) {
    logger.error('Batch size must be a positive number');
    process.exit(1);
  }

  // Connect to Solana
  logger.info(`Connecting to Solana RPC: ${rpc}`);
  const connection = new Connection(rpc);

  // Load sender keypair
  logger.info(`Loading keypair from: ${keypairPath}`);
  let keypairData;
  try {
    keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  } catch (error) {
    logger.error(`Failed to read keypair: ${error}`);
    process.exit(1);
  }
  const sender = Keypair.fromSecretKey(new Uint8Array(keypairData));
  logger.info(`Sender address: ${sender.publicKey.toString()}`);

  // Validate mint address
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintAddress);
    logger.info(`Token mint address: ${mint.toString()}`);
  } catch (error) {
    logger.error(`Invalid mint address: ${error}`);
    process.exit(1);
  }

  // Load receivers from CSV
  logger.info(`Reading receivers from CSV: ${receiversPath}`);
  const progressFilePath = getProgressFileName(receiversPath);
  const recipients = await readRecordsFromCSV<TokenRecipientRecord>(receiversPath, validateTokenRecipient);

  // Load progress (if exists)
  const progress = loadProgress<TokenRecipientRecord[]>(progressFilePath) || recipients;
  const pendingRecipients = progress.filter((r: TokenRecipientRecord) => !r.transferred);
  
  logger.info(`Total recipients: ${recipients.length}, Pending: ${pendingRecipients.length}`);
  if (pendingRecipients.length === 0) {
    logger.info('No pending transfers. All done!');
    return;
  }

  // Check balance
  logger.info('Checking token balance...');
  try {
    const senderTokenAccount = await getAssociatedTokenAddress(
      mint,
      sender.publicKey
    );
    
    try {
      const tokenAccountInfo = await connection.getTokenAccountBalance(senderTokenAccount);
      logger.info(`Token balance: ${tokenAccountInfo.value.uiAmount} tokens`);
    } catch (error) {
      logger.error(`Failed to get token balance. Make sure the sender has a token account for this mint: ${error}`);
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Failed to get associated token address: ${error}`);
    process.exit(1);
  }

  // Process in batches
  const totalBatches = Math.ceil(pendingRecipients.length / batchSize);
  logger.info(`Processing ${pendingRecipients.length} transfers in ${totalBatches} batches of ${batchSize}`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, pendingRecipients.length);
    const currentBatch = pendingRecipients.slice(start, end);
    
    logger.info(`Processing batch ${batchIndex + 1}/${totalBatches}, items ${start + 1}-${end}...`);
    
    for (let i = 0; i < currentBatch.length; i++) {
      const recipient = currentBatch[i];
      logger.info(`[${start + i + 1}/${pendingRecipients.length}] Transferring ${recipient.amount} tokens to ${recipient.address}`);
      
      try {
        // Convert amount string to correct decimal representation for token transfer
        const amount = parseInt(recipient.amount);
        if (isNaN(amount)) {
          throw new Error(`Invalid amount format: ${recipient.amount}`);
        }

        const signature = await transferTokensToAddress(
          connection,
          sender,
          recipient.address,
          mintAddress,
          amount,
          receiversPath // Pass the receiversPath as log identifier
        );
        
        // Log important info about the batch progress
        logImportant(
          receiversPath, // Use the CSV file path as the log identifier
          `Transfer successful!`, 
          {
            type: 'batch_progress',
            signature: signature,
            recipient: recipient.address,
            amount: amount,
            current: i + 1,
            total: pendingRecipients.length,
            batchNumber: batchIndex + 1,
            totalBatches: totalBatches
          }
        );
        
        // Update progress
        const index = progress.findIndex(
          (r: TokenRecipientRecord) => r.address === recipient.address && r.amount === recipient.amount
        );
        if (index !== -1) {
          progress[index].transferred = true;
          saveProgress<TokenRecipientRecord[]>(progressFilePath, progress);
        }
      } catch (error) {
        logger.error(`Transfer failed: ${error}`);
      }
    }
    
    logger.info(`Batch ${batchIndex + 1}/${totalBatches} completed`);
  }
  
  // Final report
  const remainingRecipients = progress.filter(r => !r.transferred);
  logger.info(`Token transfers completed. ${progress.length - remainingRecipients.length}/${progress.length} transfers processed.`);
  if (remainingRecipients.length > 0) {
    logger.info(`${remainingRecipients.length} transfers pending. Run the command again to process remaining transfers.`);
  }
};
