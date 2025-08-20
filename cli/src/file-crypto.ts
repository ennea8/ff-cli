import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveFileConflict, FileConflictResolution } from './utils';
import readline from 'readline';

// Constants for crypto operations
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM mode
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64; // Salt for key derivation
const ITERATIONS = 100000; // PBKDF2 iterations
const DIGEST = 'sha512'; // Hash algorithm for PBKDF2

/**
 * Derive a crypto key from a password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}

/**
 * Encrypt a file with a password
 * @param inputPath Path to the file to encrypt
 * @param outputPath Path where the encrypted file will be saved
 * @param password Password for encryption
 * @returns Promise that resolves when encryption is complete
 */
export async function encryptFile(
  inputPath: string,
  outputPath: string,
  password: string
): Promise<void> {
  try {
    const inputData = fs.readFileSync(inputPath);
    
    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Derive key from password and salt
    const key = deriveKey(password, salt);
    
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt data
    let encrypted = cipher.update(inputData);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    // Write salt + iv + authTag + encrypted data to output file
    const outputData = Buffer.concat([
      salt,
      iv,
      authTag,
      encrypted
    ]);
    
    fs.writeFileSync(outputPath, outputData);
    console.log(`File successfully encrypted and saved to ${outputPath}`);
  } catch (error) {
    console.error('Encryption failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Decrypt a file with a password
 * @param inputPath Path to the encrypted file
 * @param outputPath Path where the decrypted file will be saved
 * @param password Password for decryption
 * @returns Promise that resolves when decryption is complete
 */
export async function decryptFile(
  inputPath: string,
  outputPath: string,
  password: string
): Promise<void> {
  try {
    const encryptedData = fs.readFileSync(inputPath);
    
    // Extract salt, iv, authTag and encrypted data
    const salt = encryptedData.subarray(0, SALT_LENGTH);
    const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = encryptedData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = encryptedData.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    
    // Derive key from password and salt
    const key = deriveKey(password, salt);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt data
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    fs.writeFileSync(outputPath, decrypted);
    console.log(`File successfully decrypted and saved to ${outputPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unsupported state or unable to authenticate data')) {
      console.error('Decryption failed: Invalid password or corrupted file');
    } else {
      console.error('Decryption failed:', error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

/**
 * More robust password masking utility that works across different terminals
 */
export async function promptForPassword(prompt: string = 'Enter password: '): Promise<string> {
  // Wait a moment to ensure terminal is ready after any previous prompts
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return new Promise((resolve) => {
    // Save the original terminal settings
    const isTTY = process.stdin.isTTY;
    let oldSettings: any;
    
    if (isTTY) {
      // Only try to change terminal settings if we're in a TTY
      oldSettings = process.stdin.isRaw;
      process.stdin.setRawMode?.(true);
    }
    
    // Print the prompt with a clear indicator
    process.stdout.write(`\n>> ${prompt}> `);
    
    // Clear any existing input buffers
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    // Prepare for password input
    let password = '';
    
    const onData = (data: Buffer) => {
      const char = data.toString();
      
      // Ctrl+C or Ctrl+D (terminate)
      if (char === '\u0003' || char === '\u0004') {
        console.log('\nPassword input cancelled');
        cleanup();
        process.exit(1);
      }
      
      // Enter key
      else if (char === '\r' || char === '\n') {
        cleanup();
        // Move to next line
        process.stdout.write('\n');
        resolve(password);
      }
      
      // Backspace or Delete
      else if (char === '\b' || char === '\x7f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          // Erase one character from terminal
          process.stdout.write('\b \b');
        }
      }
      
      // Regular character
      else if (char.length === 1 && char >= ' ') {
        password += char;
        // Print * for each character
        process.stdout.write('*');
      }
    };
    
    // Function to clean up event listeners and restore terminal
    const cleanup = () => {
      // Restore terminal settings
      if (isTTY) {
        process.stdin.setRawMode?.(oldSettings);
      }
      
      // Remove the listener
      process.stdin.removeListener('data', onData);
    };
    
    // Listen for keypress events
    process.stdin.on('data', onData);
  });
}

/**
 * Handle file encryption command execution
 */
export async function executeFileEncryption(
  inputFile: string,
  outputFile: string | undefined,
  passwordArg: string | undefined
): Promise<void> {
  try {
    // Validate input file exists
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }
    
    // Generate output file path if not provided
    let finalOutputFile = outputFile || `${inputFile}.encrypted`;
    
    // Check if output file exists and resolve conflict
    if (fs.existsSync(finalOutputFile)) {
      const result = await resolveFileConflict(finalOutputFile);
      
      switch (result.action) {
        case FileConflictResolution.OVERWRITE:
          // Continue with the existing path
          break;
          
        case FileConflictResolution.RENAME:
          // Use the new path
          if (result.newPath) {
            finalOutputFile = result.newPath;
          }
          break;
          
        case FileConflictResolution.CANCEL:
        default:
          // Exit gracefully
          process.stdin.resume();
          process.nextTick(() => process.exit(0));
          return;
      }
    }
    
    // Get password (prompt if not provided)
    const password = passwordArg || await promptForPassword('Enter encryption password: ');
    
    if (!password || password.length === 0) {
      throw new Error('Password cannot be empty');
    }
    
    // Encrypt the file
    await encryptFile(inputFile, finalOutputFile, password);
    
    // Security reminder
    console.log(`\nFile successfully encrypted and saved to ${finalOutputFile}`);
    console.log('IMPORTANT: Keep your password safe. If you lose it, you won\'t be able to decrypt the file.');
    
    // Force process exit after a brief delay to ensure all output is written
    setTimeout(() => {
      // Make sure stdin is properly reset
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.exit(0); // Force exit with success code
    }, 100);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1); // Exit with error code
  }
}

/**
 * Handle file decryption command execution
 */
export async function executeFileDecryption(
  inputFile: string,
  outputFile: string | undefined,
  passwordArg: string | undefined
): Promise<void> {
  try {
    // Validate input file exists
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }
    
    // Generate output file path if not provided
    let finalOutputFile = outputFile;
    if (!finalOutputFile) {
      // If the input file has .encrypted extension, remove it
      if (inputFile.endsWith('.encrypted')) {
        finalOutputFile = inputFile.slice(0, -10); // remove .encrypted
      } else {
        // Otherwise add .decrypted suffix
        finalOutputFile = `${inputFile}.decrypted`;
      }
    }
    
    // Check if output file exists and resolve conflict
    if (fs.existsSync(finalOutputFile)) {
      const result = await resolveFileConflict(finalOutputFile);
      
      switch (result.action) {
        case FileConflictResolution.OVERWRITE:
          // Continue with the existing path
          break;
          
        case FileConflictResolution.RENAME:
          // Use the new path
          if (result.newPath) {
            finalOutputFile = result.newPath;
          }
          break;
          
        case FileConflictResolution.CANCEL:
        default:
          // Exit gracefully
          process.stdin.resume();
          process.nextTick(() => process.exit(0));
          return;
      }
    }
    
    // Get password (prompt if not provided)
    const password = passwordArg || await promptForPassword('Enter decryption password: ');
    
    if (!password || password.length === 0) {
      throw new Error('Password cannot be empty');
    }
    
    // Decrypt the file
    await decryptFile(inputFile, finalOutputFile, password);
    
    console.log(`File successfully decrypted and saved to ${finalOutputFile}`);
    
    // Force process exit after a brief delay to ensure all output is written
    setTimeout(() => {
      // Make sure stdin is properly reset
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.exit(0); // Force exit with success code
    }, 100);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1); // Exit with error code
  }
}
