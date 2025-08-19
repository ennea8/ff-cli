import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import { createObjectCsvWriter } from 'csv-writer';
import { logger } from './utils';
import bs58 from 'bs58';

// Interface for generated wallet data
interface GeneratedWallet {
  address: string;
  base58: string;
  array: string;
}

/**
 * Generate a single random Solana wallet
 * @returns Generated wallet with address, base58 private key, and array format
 */
function generateRandomWallet(): GeneratedWallet {
  // Generate new keypair
  const keypair = Keypair.generate();
  
  // Get public key (address)
  const address = keypair.publicKey.toBase58();
  
  // Get private key in base58 format (proper base58 string)
  const secretKeyBytes = keypair.secretKey;
  const base58 = bs58.encode(secretKeyBytes);
  
  // Get private key in array format (without quotes)
  const arrayData = Array.from(keypair.secretKey);
  const array = `[${arrayData.join(',')}]`;
  
  return {
    address,
    base58,
    array
  };
}

/**
 * Generate multiple random wallets
 * @param count - Number of wallets to generate
 * @returns Array of generated wallets
 */
function generateRandomWallets(count: number): GeneratedWallet[] {
  const wallets: GeneratedWallet[] = [];
  
  logger.info(`Generating ${count} random wallets...`);
  
  for (let i = 0; i < count; i++) {
    const wallet = generateRandomWallet();
    wallets.push(wallet);
    
    // Log progress for large batches
    if (count > 10 && (i + 1) % 10 === 0) {
      logger.info(`Generated ${i + 1}/${count} wallets`);
    }
  }
  
  logger.info(`Successfully generated ${wallets.length} wallets`);
  return wallets;
}

/**
 * Save generated wallets to CSV file
 * @param wallets - Array of generated wallets
 * @param outputFile - Output CSV file path
 */
async function saveWalletsToCsv(wallets: GeneratedWallet[], outputFile: string): Promise<void> {
  try {
    // Ensure the directory exists
    const dirname = path.dirname(outputFile);
    if (dirname !== '.' && !fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
      logger.info(`Created directory: ${dirname}`);
    }
    
    // Write CSV manually to avoid automatic quoting
    let csvContent = 'address,base58,array\n';
    
    for (const wallet of wallets) {
      csvContent += `${wallet.address},${wallet.base58},${wallet.array}\n`;
    }
    
    // Write to file
    fs.writeFileSync(outputFile, csvContent, 'utf8');
    logger.info(`Wallets saved to ${outputFile}`);
  } catch (error) {
    logger.error(`Error saving wallets to CSV: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Main function to execute wallet generation
 * @param count - Number of wallets to generate
 * @param outputPath - Output file path (optional)
 */
export const executeWalletGeneration = async (
  count: number,
  outputPath?: string
) => {
  try {
    // Validate parameters
    if (count <= 0) {
      throw new Error('Count must be greater than 0');
    }
    if (count > 10000) {
      throw new Error('Count must not exceed 10,000 for safety');
    }

    // Generate wallets
    const wallets = generateRandomWallets(count);

    // Generate output filename if not provided
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const finalOutputPath = outputPath || path.join(process.cwd(), 'out', `wallets_${count}_${timestamp}.csv`);

    // Save wallets to CSV
    await saveWalletsToCsv(wallets, finalOutputPath);

    // Summary
    logger.info(`\nWallet generation complete:`);
    logger.info(`- Generated wallets: ${wallets.length}`);
    logger.info(`- Output file: ${finalOutputPath}`);
    logger.info(`- Format: address,base58,array`);

    // Security warning
    logger.warn(`\n⚠️  SECURITY WARNING:`);
    logger.warn(`Generated private keys are stored in plain text.`);
    logger.warn(`Keep the CSV file secure and delete when no longer needed.`);

  } catch (error) {
    logger.error(`Wallet generation failed: ${error}`);
    throw error;
  }
};
