import fs from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { logger, getProgressFileName, saveProgress, loadProgress, readRecordsFromCSV } from './utils';

// Interface for recipient record from CSV
interface RecipientRecord {
  address: string;
  amount: string;
  transferred?: boolean;
}

// Validate recipient records from CSV
const validateRecipient = (record: any, index: number): RecipientRecord => {
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

// Transfer SOL to a single address
const transferSol = async (
  connection: Connection,
  sender: Keypair,
  recipientAddress: string,
  amountInSol: number
): Promise<string> => {
  try {
    const recipient = new PublicKey(recipientAddress);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient,
        lamports: amountInSol * LAMPORTS_PER_SOL,
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [sender]);
    logger.info(`Transfer successful: ${amountInSol} SOL to ${recipientAddress}`);
    logger.info(`Transaction signature: ${signature}`);
    return signature;
  } catch (error) {
    logger.error(`Transfer failed to ${recipientAddress}: ${error}`);
    throw error;
  }
};

// Main function to execute batch transfer
export const executeTransfer = async (
  rpcUrl: string,
  keypairPath: string,
  receiversPath: string,
  batchSize: number | string
) => {
  // Ensure batchSize is a number
  const batchSizeNum = typeof batchSize === 'string' ? parseInt(batchSize, 10) : batchSize;
  if (isNaN(batchSizeNum) || batchSizeNum < 1) {
    logger.error(`Invalid batch size: ${batchSize}, using default of 1`);
    batchSize = 1;
  } else {
    batchSize = batchSizeNum;
  }
  // Connect to the Solana cluster
  logger.info(`Connecting to Solana network at ${rpcUrl}`);
  const connection = new Connection(rpcUrl);

  // Load sender keypair
  let sender: Keypair;
  try {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    sender = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    logger.info(`Sender: ${sender.publicKey.toString()}`);
  } catch (error) {
    logger.error(`Failed to load keypair: ${error}`);
    process.exit(1);
  }

  // Check sender balance
  const balance = await connection.getBalance(sender.publicKey);
  const balanceInSol = balance / LAMPORTS_PER_SOL;
  logger.info(`Sender balance: ${balanceInSol} SOL`);

  // Load or create recipients list
  const progressFile = getProgressFileName(receiversPath);
  let recipients: RecipientRecord[] = loadProgress<RecipientRecord[]>(progressFile) || 
    readRecordsFromCSV<RecipientRecord>(receiversPath, validateRecipient);
  
  // Calculate total amount needed
  const totalAmountNeeded = recipients
    .filter(r => !r.transferred)
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);
  
  logger.info(`Total recipients: ${recipients.length}`);
  logger.info(`Remaining transfers: ${recipients.filter(r => !r.transferred).length}`);
  logger.info(`Total amount needed: ${totalAmountNeeded} SOL`);
  
  if (balanceInSol < totalAmountNeeded) {
    logger.error(`Insufficient balance. Need ${totalAmountNeeded} SOL but only have ${balanceInSol} SOL`);
    process.exit(1);
  }

  // Process transfers in batches
  const pendingTransfers = recipients.filter(r => r.transferred !== true);
  
  // Calculate total batches
  const totalBatches = Math.ceil(pendingTransfers.length / batchSize);
  
  for (let i = 0; i < pendingTransfers.length; i += batchSize) {
    const batch = pendingTransfers.slice(i, i + batchSize);
    const currentBatch = Math.floor(i / batchSize) + 1;
    
    logger.info(`Processing batch ${currentBatch}/${totalBatches}`);
    
    for (const recipient of batch) {
      try {
        await transferSol(
          connection,
          sender,
          recipient.address,
          parseFloat(recipient.amount)
        );
        
        // Mark as transferred
        const index = recipients.findIndex(
          r => r.address === recipient.address && r.amount === recipient.amount
        );
        if (index !== -1) {
          recipients[index].transferred = true;
          // Save progress after each successful transfer
          saveProgress(progressFile, recipients);
        }
      } catch (error) {
        logger.error(`Failed to transfer to ${recipient.address}: ${error}`);
        // Continue with the next recipient
      }
    }
    
    logger.info(`Completed batch ${currentBatch}/${totalBatches}`);
  }

  const completedCount = recipients.filter(r => r.transferred).length;
  logger.info(`Transfer complete. ${completedCount}/${recipients.length} successful transfers.`);
};

// The executeTransfer function is already exported above
