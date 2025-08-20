import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import pino from 'pino';
import * as dotenv from 'dotenv';

dotenv.config();

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Setup console logger with pretty print
export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

// Global variable to store current file logger
let currentFileLogger: pino.Logger | null = null;
let currentLogFile: string | null = null;

// Function to get a log file name based on input CSV file
const getLogFileName = (inputFilePath: string): string => {
  const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
  return `${baseName}.log`;
};

// Function to initialize or get file logger
const getFileLogger = (inputFilePath: string): pino.Logger => {
  // Generate log file name based on input file name
  const logFileName = getLogFileName(inputFilePath);
  const logFilePath = path.join(logsDir, logFileName);
  
  // If we already have a logger for this file, return it
  if (currentFileLogger && currentLogFile === logFilePath) {
    return currentFileLogger;
  }
  
  // Create a new logger
  const fileTransport = pino.transport({
    target: 'pino/file',
    options: { destination: logFilePath }
  });
  
  currentFileLogger = pino(fileTransport);
  currentLogFile = logFilePath;
  
  return currentFileLogger;
};

// Enhanced logger functions
export const logTransaction = (inputFilePath: string, message: string, txHash: string, extraInfo?: Record<string, any>) => {
  // Log to console
  logger.info(`${message}: ${txHash}`);
  
  // Get file logger for this input file
  const fileLogger = getFileLogger(inputFilePath);
  
  // Log to file with more details
  fileLogger.info({
    timestamp: new Date().toISOString(),
    type: 'TRANSACTION',
    message,
    txHash,
    ...extraInfo
  });
};

export const logImportant = (inputFilePath: string, message: string, data?: Record<string, any>) => {
  // Log to console
  logger.info(message);
  
  // Get file logger for this input file
  const fileLogger = getFileLogger(inputFilePath);
  
  // Log to file with more details
  fileLogger.info({
    timestamp: new Date().toISOString(),
    type: 'IMPORTANT',
    message,
    ...data
  });
};

// Create a progress tracking file name based on the input file
export const getProgressFileName = (filePath: string): string => {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  return path.join(directory, `${baseName}_progress.json`);
};

// Save progress to a JSON file
export const saveProgress = <T>(progressFile: string, data: T): void => {
  try {
    fs.writeFileSync(progressFile, JSON.stringify(data, null, 2));
    logger.info(`Progress saved to ${progressFile}`);
  } catch (error) {
    logger.error(`Failed to save progress: ${error}`);
  }
};

// Load progress from JSON file if it exists
export const loadProgress = <T>(progressFile: string): T | null => {
  try {
    if (fs.existsSync(progressFile)) {
      const data = fs.readFileSync(progressFile, 'utf8');
      logger.info(`Found progress file: ${progressFile}`);
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error(`Error loading progress file: ${error}`);
  }
  return null;
};

/**
 * Prompt the user for confirmation before overwriting an existing file
 * @param filePath Path to the file that would be overwritten
 * @returns Promise that resolves to true if user confirms, false otherwise
 */
// Track if we've already shown a confirmation to prevent duplicates
let confirmationShown = false;

/**
 * Represents the outcome of file conflict resolution
 */
export enum FileConflictResolution {
  OVERWRITE = 'overwrite',  // Replace the existing file
  RENAME = 'rename',        // Create a new file with a different name
  CANCEL = 'cancel',        // Cancel the operation
  COMPARE = 'compare'       // Show information about both files
}

/**
 * Get file stats in a human-readable format
 * @param filePath Path to the file
 * @returns Object with human-readable file information
 */
const getFileInfo = (filePath: string) => {
  try {
    const stats = fs.statSync(filePath);
    const sizeInBytes = stats.size;
    let sizeStr;
    
    if (sizeInBytes < 1024) {
      sizeStr = `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      sizeStr = `${(sizeInBytes / 1024).toFixed(1)} KB`;
    } else {
      sizeStr = `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    
    return {
      size: sizeStr,
      modified: stats.mtime.toLocaleString(),
    };
  } catch (error) {
    return { size: 'unknown', modified: 'unknown' };
  }
};

/**
 * Generate a unique filename by appending a number
 * @param filePath Original file path
 * @returns New unique file path
 */
const generateUniqueFilename = (filePath: string): string => {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  let counter = 1;
  let newPath = `${dir}/${baseName} (${counter})${ext}`;
  
  while (fs.existsSync(newPath)) {
    counter++;
    newPath = `${dir}/${baseName} (${counter})${ext}`;
  }
  
  return newPath;
};

/**
 * Result of file conflict resolution
 */
export interface FileConflictResult {
  action: FileConflictResolution;
  newPath?: string;
}

/**
 * Handle file conflict resolution with multiple options
 * @param filePath Path to the file that would be overwritten
 * @returns Promise that resolves to a FileConflictResult object
 */
export const resolveFileConflict = async (filePath: string): Promise<FileConflictResult> => {
  if (!fs.existsSync(filePath)) {
    return { action: FileConflictResolution.OVERWRITE }; // No conflict
  }
  
  // If we've already shown a confirmation in this process, just overwrite
  if (confirmationShown) {
    return { action: FileConflictResolution.OVERWRITE };
  }
  
  // Get info about existing file
  const fileInfo = getFileInfo(filePath);
  
  return new Promise((resolve) => {
    // Use a separate instance of readline to avoid conflicts
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // Show file info and options
    console.log(`\n>> File conflict: '${filePath}' already exists:`);
    console.log(`   - Size: ${fileInfo.size}`);
    console.log(`   - Last modified: ${fileInfo.modified}`);
    console.log('\nOptions:');
    console.log('   1. Overwrite the existing file');
    console.log('   2. Save to a new file with auto-generated name');
    console.log('   3. Cancel operation');
    
    readline.question('\n>> Choose an option (1-3) [3]: ', (answer: string) => {
      readline.close();
      confirmationShown = true;
      
      // Process the user's choice
      setTimeout(() => {
        const choice = answer.trim();
        
        switch (choice) {
          case '1':
            // Overwrite
            console.log(`Overwriting file: ${filePath}`);
            resolve({ action: FileConflictResolution.OVERWRITE });
            break;
            
          case '2':
            // Rename - generate new path and return it
            const newPath = generateUniqueFilename(filePath);
            console.log(`Saving to: ${newPath}`);
            resolve({ action: FileConflictResolution.RENAME, newPath });
            break;
            
          default:
            // Cancel
            console.log('Operation cancelled.');
            resolve({ action: FileConflictResolution.CANCEL });
        }
      }, 100);
    });
  });
};

/**
 * Legacy compatibility function for backwards compatibility
 * @param filePath Path to check
 * @returns Promise resolving to boolean
 */
export const confirmFileOverwrite = async (filePath: string): Promise<boolean> => {
  const result = await resolveFileConflict(filePath);
  return result.action === FileConflictResolution.OVERWRITE;
};

export const readRecordsFromCSV = <T>(
  csvFile: string,
  validator?: (record: any, index: number) => T
): T[] => {
  try {
    const content = fs.readFileSync(csvFile, 'utf8');
    
    // Filter out comment lines (lines starting with #) before parsing
    const filteredContent = content
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .join('\n');
    
    const records = parse(filteredContent, {
      columns: true,
      skip_empty_lines: true,
    });
    
    if (validator) {
      return records.map((record: any, index: number) => validator(record, index));
    }
    
    return records as T[];
  } catch (error) {
    logger.error(`Failed to read CSV file: ${error}`);
    process.exit(1);
  }
};
