import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { logger } from './utils';
import { readWalletsFromCSV, WalletInfo } from './utils.wallet';

// Interface for distribution configuration
interface DistributionConfig {
  address: string;
  amount: number;
}

// Interface for wallet data (simplified from WalletInfo)
interface WalletData {
  publicKey: string;
}

/**
 * Generate random amount within specified range with decimal precision
 * @param min - Minimum amount
 * @param max - Maximum amount  
 * @param decimalPlaces - Number of decimal places
 * @returns Random amount rounded to specified decimal places
 */
function getRandomAmount(min: number, max: number, decimalPlaces: number): number {
  const random = Math.random() * (max - min) + min;
  return Math.round(random * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
}

/**
 * Allocate random amounts to wallets within constraints
 * @param wallets - Array of wallet data
 * @param minAmount - Minimum amount per wallet
 * @param maxAmount - Maximum amount per wallet
 * @param totalAmount - Total amount to distribute (optional)
 * @param decimalPlaces - Number of decimal places for amount rounding
 * @returns Distribution configuration
 */
function allocateFunds(
  wallets: WalletData[], 
  minAmount: number, 
  maxAmount: number, 
  totalAmount?: number, 
  decimalPlaces: number = 4
): DistributionConfig[] {
  const distribution: DistributionConfig[] = [];
  let remainingAmount = totalAmount || Number.MAX_SAFE_INTEGER;
  let i = 0;
  
  logger.info(`Allocating funds with min=${minAmount}, max=${maxAmount}, total=${totalAmount || 'unlimited'}`);
  
  // First pass: Allocate minimum amount to each wallet if possible
  while (i < wallets.length && remainingAmount >= minAmount) {
    const wallet = wallets[i];
    let amount: number;
    
    // If we have enough funds for a random allocation between min and max
    if (remainingAmount >= minAmount) {
      // Cap the max amount to the remaining funds if totalAmount is specified
      const effectiveMax = totalAmount ? Math.min(maxAmount, remainingAmount) : maxAmount;
      
      // For very small numbers with few decimal places, ensure we don't round to zero
      // Calculate minimum representable value at the current decimal places
      const minRepresentable = Math.pow(10, -decimalPlaces);
      
      // If min amount is less than what can be represented with current decimal places
      // adjust it to ensure we don't round to zero
      const effectiveMin = Math.max(minAmount, minRepresentable);
      
      // Generate random amount with specified decimal places
      amount = getRandomAmount(effectiveMin, effectiveMax, decimalPlaces);
      
      // Update remaining amount if totalAmount is specified
      if (totalAmount) {
        remainingAmount -= amount;
      }
      
      distribution.push({
        address: wallet.publicKey,
        amount: amount
      });
    }
    
    i++;
  }
  
  // Log distribution summary
  const allocatedTotal = distribution.reduce((sum, item) => sum + item.amount, 0);
  logger.info(`Allocated ${allocatedTotal.toFixed(decimalPlaces)} SOL to ${distribution.length} wallets`);
  if (totalAmount) {
    logger.info(`Remaining: ${remainingAmount.toFixed(decimalPlaces)} SOL`);
  }
  
  return distribution;
}

/**
 * Save distribution configuration to CSV file
 * @param distribution - Distribution configuration
 * @param outputFile - Output CSV file path
 */
async function saveDistributionToCsv(distribution: DistributionConfig[], outputFile: string): Promise<void> {
  try {
    // Ensure the directory exists
    const dirname = path.dirname(outputFile);
    if (dirname !== '.' && !fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
      logger.info(`Created directory: ${dirname}`);
    }
    
    // Create CSV writer
    const csvWriter = createObjectCsvWriter({
      path: outputFile,
      header: [
        { id: 'address', title: 'address' },
        { id: 'amount', title: 'amount' }
      ]
    });
    
    // Write data to CSV
    await csvWriter.writeRecords(distribution);
    logger.info(`Distribution saved to ${outputFile}`);
  } catch (error) {
    logger.error(`Error saving distribution to CSV: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Main function to execute fund allocation
 * @param walletsPath - Path to wallets CSV file
 * @param minAmount - Minimum amount per wallet
 * @param maxAmount - Maximum amount per wallet
 * @param totalAmount - Total amount to distribute (optional)
 * @param decimalPlaces - Number of decimal places
 * @param outputPath - Output file path (optional)
 */
export const executeFundAllocation = async (
  walletsPath: string,
  minAmount: number,
  maxAmount: number,
  totalAmount?: number,
  decimalPlaces: number = 4,
  outputPath?: string
) => {
  try {
    // Load wallet addresses from CSV
    logger.info(`Loading wallet addresses from ${walletsPath}`);
    const walletInfos = readWalletsFromCSV(walletsPath);
    logger.info(`Found ${walletInfos.length} wallet addresses`);

    // Convert WalletInfo to WalletData format
    const wallets: WalletData[] = walletInfos.map(wallet => ({
      publicKey: wallet.address
    }));

    // Validate parameters
    if (minAmount <= 0) {
      throw new Error('Minimum amount must be greater than 0');
    }
    if (maxAmount <= minAmount) {
      throw new Error('Maximum amount must be greater than minimum amount');
    }
    if (totalAmount && totalAmount < minAmount * wallets.length) {
      throw new Error(`Total amount (${totalAmount}) is insufficient for minimum allocation to all wallets`);
    }

    // Allocate funds
    const distribution = allocateFunds(wallets, minAmount, maxAmount, totalAmount, decimalPlaces);

    // Generate output filename if not provided
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const baseName = path.basename(walletsPath, path.extname(walletsPath));
    const finalOutputPath = outputPath || path.join(process.cwd(), 'out', `${baseName}_allocation_${timestamp}.csv`);

    // Save distribution to CSV
    await saveDistributionToCsv(distribution, finalOutputPath);

    // Summary
    const totalAllocated = distribution.reduce((sum, item) => sum + item.amount, 0);
    logger.info(`\nFund allocation complete:`);
    logger.info(`- Total wallets: ${wallets.length}`);
    logger.info(`- Allocated wallets: ${distribution.length}`);
    logger.info(`- Total allocated: ${totalAllocated.toFixed(decimalPlaces)}`);
    logger.info(`- Average per wallet: ${(totalAllocated / distribution.length).toFixed(decimalPlaces)}`);
    logger.info(`- Distribution saved to: ${finalOutputPath}`);

    if (totalAmount) {
      const remaining = totalAmount - totalAllocated;
      logger.info(`- Remaining funds: ${remaining.toFixed(decimalPlaces)}`);
    }

  } catch (error) {
    logger.error(`Fund allocation failed: ${error}`);
    throw error;
  }
};
