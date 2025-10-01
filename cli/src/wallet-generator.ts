import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import { createObjectCsvWriter } from 'csv-writer';
import { logger } from './utils';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { readMnemonicFromFile, getMnemonicInteractively } from './mnemonic';

// Interface for generated wallet data
interface GeneratedWallet {
  address: string;
  base58: string;
  array: string;
}


// Interface for wallet data in JSON format
interface JsonWallet {
  publicKey: string;
  secretKey: number[];
}

/**
 * Generate a single random Solana wallet
 * @returns Generated wallet with address, base58 private key, and array format
 */
/**
 * Generate a wallet from mnemonic and passphrase
 * @param mnemonic - BIP39 mnemonic
 * @param passphrase - Passphrase to use with mnemonic
 * @returns Generated wallet information
 */
function generateWalletFromMnemonic(mnemonic: string, passphrase: string): GeneratedWallet & { secretKeyArray: number[] } {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic');
  }
  
  // Generate seed from mnemonic and passphrase
  const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
  
  // Create keypair from seed
  const keypair = Keypair.fromSeed(seed.slice(0, 32));
  
  // Get public key (address)
  const address = keypair.publicKey.toBase58();
  
  // Get private key in base58 format
  const secretKeyBytes = keypair.secretKey;
  const base58 = bs58.encode(secretKeyBytes);
  
  // Get private key in array format
  const arrayData = Array.from(keypair.secretKey);
  const array = `[${arrayData.join(',')}]`;
  
  // Store the actual array for JSON output
  const secretKeyArray = Array.from(keypair.secretKey);
  
  return {
    address,
    base58,
    array,
    secretKeyArray
  };
}

/**
 * Generate a single random wallet
 * @returns Generated wallet with address, base58 private key, and array format
 */
function generateRandomWallet(): GeneratedWallet & { secretKeyArray: number[] } {
  // Generate new keypair
  const keypair = Keypair.generate();
  
  // Get public key (address)
  const address = keypair.publicKey.toBase58();
  
  // Get private key in base58 format (proper base58 string)
  const secretKeyBytes = keypair.secretKey;
  const base58 = bs58.encode(secretKeyBytes);
  
  // Get private key in array format for CSV (as string)
  const arrayData = Array.from(keypair.secretKey);
  const array = `[${arrayData.join(',')}]`;
  
  // Store the actual array for JSON output
  const secretKeyArray = Array.from(keypair.secretKey);
  
  return {
    address,
    base58,
    array,
    secretKeyArray
  };
}

/**
 * Generate multiple wallets from mnemonic
 * @param mnemonic - BIP39 mnemonic
 * @param count - Number of wallets to generate
 * @param startIndex - Starting index for passphrase generation
 * @param passphraseSuffix - Suffix to append to index for passphrase
 * @returns Array of generated wallets
 */
function generateWalletsFromMnemonic(mnemonic: string, count: number, startIndex: number = 0, passphraseSuffix: string = ''): Array<GeneratedWallet & { secretKeyArray: number[] }> {
  const wallets: Array<GeneratedWallet & { secretKeyArray: number[] }> = [];
  
  logger.info(`Generating ${count} wallets from mnemonic...`);
  logger.info(`Starting from index ${startIndex} with suffix '${passphraseSuffix}'`);
  
  for (let i = startIndex; i < startIndex + count; i++) {
    // Generate passphrase by combining index and suffix
    const passphrase = `${i}${passphraseSuffix}`;
    
    try {
      const wallet = generateWalletFromMnemonic(mnemonic, passphrase);
      wallets.push(wallet);
      
      // Log progress for large batches
      if (count > 10 && (i + 1 - startIndex) % 10 === 0) {
        logger.info(`Generated ${i + 1 - startIndex}/${count} wallets`);
      }
    } catch (error) {
      logger.error(`Failed to generate wallet at index ${i}: ${error}`);
      throw error;
    }
  }
  
  logger.info(`Successfully generated ${wallets.length} wallets from mnemonic`);
  return wallets;
}

/**
 * Generate multiple random wallets
 * @param count - Number of wallets to generate
 * @returns Array of generated wallets
 */
function generateRandomWallets(count: number): Array<GeneratedWallet & { secretKeyArray: number[] }> {
  const wallets: Array<GeneratedWallet & { secretKeyArray: number[] }> = [];
  
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
async function saveWalletsToCsv(wallets: Array<GeneratedWallet & { secretKeyArray?: number[] }>, outputFile: string): Promise<void> {
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
 * Save generated wallets to JSON file
 * @param wallets - Array of generated wallets
 * @param outputFile - Output JSON file path
 */
async function saveWalletsToJson(wallets: Array<GeneratedWallet & { secretKeyArray: number[] }>, outputFile: string): Promise<void> {
  try {
    // Ensure the directory exists
    const dirname = path.dirname(outputFile);
    if (dirname !== '.' && !fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
      logger.info(`Created directory: ${dirname}`);
    }
    
    // Convert to required JSON format
    const jsonWallets: JsonWallet[] = wallets.map(wallet => ({
      publicKey: wallet.address,
      secretKey: wallet.secretKeyArray
    }));
    
    // Write to file with proper formatting
    fs.writeFileSync(
      outputFile, 
      JSON.stringify(jsonWallets, null, 2), 
      'utf8'
    );
    
    logger.info(`Wallets saved to ${outputFile}`);
  } catch (error) {
    logger.error(`Error saving wallets to JSON: ${(error as Error).message}`);
    throw error;
  }
}


/**
 * Main function to execute wallet generation
 * @param count - Number of wallets to generate
 * @param outputPath - Output file path (optional)
 * @param jsonFormat - Whether to output in JSON format
 * @param mnemonic - BIP39 mnemonic (optional)
 * @param mnemonicFile - Path to file containing mnemonic (optional)
 * @param interactiveMnemonic - Whether to prompt for mnemonic interactively (optional)
 * @param passphraseSuffix - Suffix to append to index for passphrase (optional)
 * @param startIndex - Starting index for passphrase generation (optional)
 */
export const executeWalletGeneration = async (
  count: number,
  outputPath?: string,
  jsonFormat: boolean = false,
  mnemonic?: string,
  mnemonicFile?: string,
  interactiveMnemonic: boolean = false,
  passphraseSuffix?: string,
  startIndex: number = 0
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
    let wallets;
    let actualMnemonic: string | undefined = mnemonic;
    
    // Resolve mnemonic from different sources with priority:
    // 1. Direct mnemonic parameter
    // 2. Mnemonic file
    // 3. Interactive input
    // 4. Fall back to random generation
    
    if (!actualMnemonic && mnemonicFile) {
      actualMnemonic = await readMnemonicFromFile(mnemonicFile);
      logger.info('Using mnemonic from file');
    }
    
    if (!actualMnemonic && interactiveMnemonic) {
      actualMnemonic = await getMnemonicInteractively();
      logger.info('Using interactively entered mnemonic');
    }
    
    if (actualMnemonic) {
      // Generate from mnemonic
      wallets = generateWalletsFromMnemonic(actualMnemonic, count, startIndex, passphraseSuffix);
    } else {
      // Generate random wallets otherwise
      wallets = generateRandomWallets(count);
    }

    // Generate output filename if not provided
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    let extension = jsonFormat ? 'json' : 'csv';
    const finalOutputPath = outputPath || path.join(process.cwd(), 'out', `wallets_${count}_${timestamp}.${extension}`);

    // Save wallets to the appropriate format
    if (jsonFormat) {
      await saveWalletsToJson(wallets as Array<GeneratedWallet & { secretKeyArray: number[] }>, finalOutputPath);
    } else {
      await saveWalletsToCsv(wallets, finalOutputPath);
    }

    // Summary
    logger.info(`\nWallet generation complete:`);
    logger.info(`- Generated wallets: ${wallets.length}`);
    logger.info(`- Output file: ${finalOutputPath}`);
    logger.info(`- Format: ${jsonFormat ? 'JSON (publicKey, secretKey array)' : 'CSV (address, base58, array)'}`);
    if (mnemonic) {
      logger.info(`- Generation method: From mnemonic with index range ${startIndex}~${startIndex + count - 1}${passphraseSuffix ? ` and suffix '${passphraseSuffix}'` : ''}`);
    } else {
      logger.info(`- Generation method: Random`);
    }

    // Security warning
    logger.warn(`\n⚠️  SECURITY WARNING:`);
    logger.warn(`Generated private keys are stored in plain text.`);
    logger.warn(`Keep the CSV file secure and delete when no longer needed.`);

  } catch (error) {
    logger.error(`Wallet generation failed: ${error}`);
    throw error;
  }
};
