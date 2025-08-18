import fs from 'fs';
import path from 'path';
import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, transfer, getMint } from '@solana/spl-token';
import { createObjectCsvWriter } from 'csv-writer';
import bs58 from 'bs58';
import { logger } from './utils';
import { readWalletsFromCSV, WalletInfo } from './utils.wallet';

// Interface for transfer instruction from CSV
interface TransferInstruction {
  from: string;
  to: string;
  amount: number;
}

// Interface for transfer result
interface TransferResult {
  from: string;
  to: string;
  amount: number;
  token_mint?: string;
  transaction_signature?: string;
  status: 'success' | 'failed';
  error?: string;
  timestamp: string;
}

// Parse transfer instructions from CSV
const parseTransferInstructions = (filePath: string): TransferInstruction[] => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    const instructions: TransferInstruction[] = [];
    
    // Skip header row if it contains "from"
    let startIndex = 0;
    if (lines.length > 0 && lines[0].toLowerCase().includes('from')) {
      startIndex = 1;
    }
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue;
      
      const parts = line.split(',').map(part => part.trim());
      if (parts.length < 3) {
        logger.warn(`Warning: Invalid transfer instruction format on line ${i + 1}: ${line}`);
        continue;
      }
      
      const [from, to, amountStr] = parts;
      const amount = parseFloat(amountStr);
      
      if (isNaN(amount) || amount <= 0) {
        logger.warn(`Warning: Invalid amount on line ${i + 1}: ${amountStr}`);
        continue;
      }
      
      instructions.push({ from, to, amount });
    }
    
    return instructions;
  } catch (error) {
    throw new Error(`Failed to read transfer instructions CSV file: ${error}`);
  }
};

// Create keypair from base58 private key
const createKeypairFromBase58 = (base58Key: string): Keypair => {
  try {
    const secretKey = bs58.decode(base58Key);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error(`Failed to create keypair from base58 key: ${error}`);
  }
};

// Execute SOL transfer
const executeSolTransfer = async (
  connection: Connection,
  fromKeypair: Keypair,
  toAddress: string,
  amount: number
): Promise<string> => {
  const toPublicKey = new PublicKey(toAddress);
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPublicKey,
      lamports: amount * LAMPORTS_PER_SOL,
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
  return signature;
};

// Execute token transfer
const executeTokenTransfer = async (
  connection: Connection,
  fromKeypair: Keypair,
  toAddress: string,
  amount: number,
  mintAddress: string
): Promise<string> => {
  const mintPublicKey = new PublicKey(mintAddress);
  const toPublicKey = new PublicKey(toAddress);
  
  // Get mint info to determine decimals
  const mintInfo = await getMint(connection, mintPublicKey);
  
  // Get or create associated token accounts
  const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    fromKeypair,
    mintPublicKey,
    fromKeypair.publicKey
  );
  
  const toTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    fromKeypair,
    mintPublicKey,
    toPublicKey
  );
  
  // Execute transfer
  const signature = await transfer(
    connection,
    fromKeypair,
    fromTokenAccount.address,
    toTokenAccount.address,
    fromKeypair,
    amount * Math.pow(10, mintInfo.decimals)
  );
  
  return signature;
};

// Print results table to console
const printResultsTable = (results: TransferResult[], mintAddress?: string) => {
  console.log('\n' + '='.repeat(120));
  console.log('BATCH TRANSFER RESULTS');
  console.log('='.repeat(120));
  
  const headers = ['From', 'To', 'Amount', 'Status', 'Transaction/Error'];
  if (mintAddress) {
    headers.splice(2, 0, 'Token');
  }
  
  // Print header
  const colWidths = [20, 20, 15, 10, 50];
  if (mintAddress) colWidths.splice(2, 0, 15);
  
  let headerRow = '';
  headers.forEach((header, i) => {
    headerRow += header.padEnd(colWidths[i]);
  });
  console.log(headerRow);
  console.log('-'.repeat(120));
  
  // Print results
  results.forEach(result => {
    const values = [
      result.from.substring(0, 18) + '...',
      result.to.substring(0, 18) + '...',
      result.amount.toString(),
      result.status,
      result.status === 'success' 
        ? (result.transaction_signature?.substring(0, 45) + '...' || 'N/A')
        : (result.error?.substring(0, 45) + '...' || 'Unknown error')
    ];
    
    if (mintAddress) {
      values.splice(2, 0, 'TOKEN');
    }
    
    let row = '';
    values.forEach((value, i) => {
      row += value.padEnd(colWidths[i]);
    });
    console.log(row);
  });
  
  console.log('='.repeat(120));
  
  // Print summary
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  const totalAmount = results
    .filter(r => r.status === 'success')
    .reduce((sum, r) => sum + r.amount, 0);
  
  console.log(`Summary: ${successCount} successful, ${failedCount} failed transfers`);
  console.log(`Total amount transferred: ${totalAmount} ${mintAddress ? 'tokens' : 'SOL'}`);
  console.log('='.repeat(120) + '\n');
};

// Save results to CSV file
const saveResultsToCSV = async (
  results: TransferResult[],
  outputPath: string
): Promise<void> => {
  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const headers = [
      { id: 'from', title: 'From' },
      { id: 'to', title: 'To' },
      { id: 'amount', title: 'Amount' },
      { id: 'token_mint', title: 'Token Mint' },
      { id: 'transaction_signature', title: 'Transaction Signature' },
      { id: 'status', title: 'Status' },
      { id: 'error', title: 'Error' },
      { id: 'timestamp', title: 'Timestamp' },
    ];

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

// Main function to execute batch transfer
export const executeBatchTransfer = async (
  rpcUrl: string,
  walletsPath: string,
  transfersPath: string,
  mintAddress?: string
) => {
  // Connect to the Solana cluster
  logger.info(`Connecting to Solana network at ${rpcUrl}`);
  const connection = new Connection(rpcUrl);

  // Load wallet information
  logger.info(`Loading wallet information from ${walletsPath}`);
  const wallets = readWalletsFromCSV(walletsPath);
  const walletMap = new Map<string, WalletInfo>();
  wallets.forEach(wallet => {
    walletMap.set(wallet.address, wallet);
  });
  logger.info(`Loaded ${wallets.length} wallets`);

  // Load transfer instructions
  logger.info(`Loading transfer instructions from ${transfersPath}`);
  const instructions = parseTransferInstructions(transfersPath);
  logger.info(`Loaded ${instructions.length} transfer instructions`);

  // Prepare results array
  const results: TransferResult[] = [];

  // Execute transfers
  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    logger.info(`Processing transfer ${i + 1}/${instructions.length}: ${instruction.from} -> ${instruction.to} (${instruction.amount})`);

    const result: TransferResult = {
      from: instruction.from,
      to: instruction.to,
      amount: instruction.amount,
      token_mint: mintAddress,
      status: 'failed',
      timestamp: new Date().toISOString(),
    };

    try {
      // Find wallet info for sender
      const walletInfo = walletMap.get(instruction.from);
      if (!walletInfo) {
        throw new Error(`Wallet not found for address: ${instruction.from}`);
      }

      // Create keypair from base58 private key
      const fromKeypair = createKeypairFromBase58(walletInfo.base58Key);

      // Execute transfer based on type
      let signature: string;
      if (mintAddress) {
        signature = await executeTokenTransfer(
          connection,
          fromKeypair,
          instruction.to,
          instruction.amount,
          mintAddress
        );
      } else {
        signature = await executeSolTransfer(
          connection,
          fromKeypair,
          instruction.to,
          instruction.amount
        );
      }

      result.transaction_signature = signature;
      result.status = 'success';
      logger.info(`Transfer successful: ${signature}`);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      logger.error(`Transfer failed: ${result.error}`);
    }

    results.push(result);
  }

  // Print results table
  printResultsTable(results, mintAddress);

  // Generate output filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const transfersBaseName = path.basename(transfersPath, path.extname(transfersPath));
  const outputFileName = mintAddress 
    ? `${transfersBaseName}_batch_transfer_${timestamp}_token.csv`
    : `${transfersBaseName}_batch_transfer_${timestamp}.csv`;
  const outputPath = path.join(process.cwd(), 'out', outputFileName);

  // Save results to CSV
  await saveResultsToCSV(results, outputPath);

  // Final summary
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  
  logger.info(`Batch transfer complete:`);
  logger.info(`- Total transfers: ${results.length}`);
  logger.info(`- Successful: ${successCount}`);
  logger.info(`- Failed: ${failedCount}`);
  logger.info(`- Results saved to: ${outputPath}`);
};
