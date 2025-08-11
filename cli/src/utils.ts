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

// Read records from CSV file
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
