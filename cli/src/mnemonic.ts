import fs from 'fs';
import path from 'path';
import * as bip39 from 'bip39';
import { logger } from './utils';

/**
 * Generate and save a BIP39 mnemonic phrase to file
 * @param strength - The strength of the mnemonic (128, 160, 192, 224, 256)
 * @param outputPath - The output file path
 * @returns Generated mnemonic and output path
 */
export const generateAndSaveMnemonic = async (
  strength: number = 128,
  outputPath?: string
): Promise<{ mnemonic: string; outputPath: string }> => {
  try {
    // Validate strength parameter
    if (![128, 160, 192, 224, 256].includes(strength)) {
      throw new Error('Strength must be one of: 128, 160, 192, 224, 256');
    }
    
    // Generate a random mnemonic
    const mnemonic = bip39.generateMnemonic(strength);
    logger.info(`Generated ${strength}-bit BIP39 mnemonic (${strength / 8} words)`);
    
    // Generate output filename if not provided
    if (!outputPath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
      outputPath = path.join(process.cwd(), 'out', `mnemonic_${timestamp}.txt`);
    }
    
    // Ensure the directory exists
    const dirname = path.dirname(outputPath);
    if (dirname !== '.' && !fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
      logger.info(`Created directory: ${dirname}`);
    }
    
    // Save mnemonic to file
    fs.writeFileSync(outputPath, mnemonic, 'utf8');
    logger.info(`Mnemonic saved to ${outputPath}`);
    
    // Security warning
    logger.warn(`\n⚠️  SECURITY WARNING:`);
    logger.warn(`The mnemonic phrase is stored in plain text.`);
    logger.warn(`Keep the file secure and delete when no longer needed.`);
    logger.warn(`Consider encrypting the file with 'ff encrypt' command.`);
    
    return { mnemonic, outputPath };
  } catch (error) {
    logger.error(`Failed to generate mnemonic: ${error}`);
    throw error;
  }
};

/**
 * Read mnemonic phrase from a file
 * @param filePath - Path to the file containing the mnemonic
 * @returns The mnemonic phrase
 */
export async function readMnemonicFromFile(filePath: string): Promise<string> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Read file content and normalize it
    let content = fs.readFileSync(filePath, 'utf8')
      .trim()
      .replace(/\r?\n|\r/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' ');     // Normalize spaces
    
    // Try to validate the mnemonic
    if (!bip39.validateMnemonic(content)) {
      // If invalid, try to repair common issues
      logger.warn('Mnemonic validation failed, attempting to normalize format...');
      
      // Try a few normalization techniques
      const contentWithoutQuotes = content.replace(/["']/g, '');
      
      if (bip39.validateMnemonic(contentWithoutQuotes)) {
        logger.info('Normalized mnemonic is now valid');
        content = contentWithoutQuotes;
      } else {
        throw new Error('Invalid mnemonic in file - could not repair format');
      }
    }
    
    logger.info(`Mnemonic successfully read from ${filePath}`);
    return content;
  } catch (error) {
    logger.error(`Error reading mnemonic from file: ${error}`);
    throw error;
  }
}

/**
 * Get mnemonic phrase via interactive prompt
 * @returns The mnemonic phrase entered by the user
 */
export async function getMnemonicInteractively(): Promise<string> {
  const prompts = require('prompts');
  
  try {
    logger.info('Interactive mnemonic entry:');
    
    const response = await prompts({
      type: 'password',
      name: 'mnemonic',
      message: 'Enter your mnemonic phrase (input is hidden):',
      validate: (value: string) => {
        if (!value) return 'Mnemonic cannot be empty';
        if (!bip39.validateMnemonic(value)) return 'Invalid mnemonic phrase';
        return true;
      }
    });
    
    // User cancelled
    if (!response.mnemonic) {
      throw new Error('Mnemonic entry cancelled');
    }
    
    return response.mnemonic.trim();
  } catch (error) {
    logger.error(`Error during interactive mnemonic entry: ${error}`);
    throw error;
  }
}

/**
 * Validate a mnemonic phrase
 * @param mnemonic - The mnemonic phrase to validate
 * @returns True if the mnemonic is valid, false otherwise
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

// Re-export bip39 functions that might be useful
export { generateMnemonic } from 'bip39';
