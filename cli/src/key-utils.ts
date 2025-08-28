import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import { PublicKey, Keypair } from '@solana/web3.js';
import { logger } from './utils';

/**
 * Convert array format key to base58 string
 * @param arrayStr Array format key string (e.g. [1,2,3])
 * @returns base58 encoded string
 */
export function arrayToBase58(arrayStr: string): string {
  try {
    // Parse array string to actual array
    const cleanedStr = arrayStr.replace(/^\[|\]$/g, '').trim();
    const byteArray = cleanedStr.split(',').map(num => parseInt(num.trim(), 10));
    
    // Validate array
    if (byteArray.some(isNaN) || byteArray.some(b => b < 0 || b > 255)) {
      throw new Error('Invalid byte array: contains invalid values');
    }
    
    // Convert to base58
    const buffer = Buffer.from(byteArray);
    return bs58.encode(buffer);
  } catch (error) {
    throw new Error(`Failed to convert array to base58: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Convert base58 string to array format
 * @param base58Str base58 encoded string
 * @returns Array format as a string [1,2,3,...]
 */
export function base58ToArray(base58Str: string): string {
  try {
    // Decode base58 to buffer
    const buffer = bs58.decode(base58Str);
    
    // Convert to array string format
    const array = Array.from(buffer);
    return `[${array.join(',')}]`;
  } catch (error) {
    throw new Error(`Failed to convert base58 to array: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get public key from a private key
 * @param privateKey Private key in base58 string format
 * @returns Public key as a base58 string
 */
export function getPublicKey(privateKey: string): string {
  try {
    // Convert base58 private key to keypair
    const secretKey = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toString();
  } catch (error) {
    throw new Error(`Failed to get public key from private key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get public key from array format private key
 * @param arrayStr Array format key string (e.g. [1,2,3])
 * @returns Public key as a base58 string
 */
export function getPublicKeyFromArray(arrayStr: string): string {
  try {
    // Convert array to base58 first
    const base58Key = arrayToBase58(arrayStr);
    // Then get public key
    return getPublicKey(base58Key);
  } catch (error) {
    throw new Error(`Failed to get public key from array: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Read key from file
 * @param filePath Path to key file
 * @returns Key content as string
 */
export function readKeyFromFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    throw new Error(`Failed to read key file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Write key to file
 * @param filePath Path to write key file
 * @param content Key content
 */
export function writeKeyToFile(filePath: string, content: string): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
    logger.info(`Key written to ${filePath}`);
  } catch (error) {
    throw new Error(`Failed to write key file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute key command
 * @param command Command type: 'pub', 'bs58', 'array'
 * @param input Input key (string or file path)
 * @param isFile Whether input is a file path
 * @param output Output file path (optional)
 */
export async function executeKeyCommand(
  command: string, 
  input: string, 
  isFile: boolean = false,
  output?: string
): Promise<void> {
  try {
    let keyContent = isFile ? readKeyFromFile(input) : input;
    let result: string;
    
    switch (command) {
      case 'pub':
        // Determine if input is array format or base58
        if (keyContent.startsWith('[') && keyContent.endsWith(']')) {
          result = getPublicKeyFromArray(keyContent);
        } else {
          result = getPublicKey(keyContent);
        }
        break;
        
      case 'bs58':
        // Convert array to base58
        if (!keyContent.startsWith('[') || !keyContent.endsWith(']')) {
          throw new Error('Input is not in array format. Expected format: [1,2,3,...]');
        }
        result = arrayToBase58(keyContent);
        break;
        
      case 'array':
        // Convert base58 to array
        if (keyContent.startsWith('[') && keyContent.endsWith(']')) {
          throw new Error('Input is already in array format. Please provide base58 encoded string.');
        }
        result = base58ToArray(keyContent);
        break;
        
      default:
        throw new Error(`Unknown command: ${command}`);
    }
    
    if (output) {
      writeKeyToFile(output, result);
      console.log(`Result written to ${output}`);
    } else {
      console.log(result);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
