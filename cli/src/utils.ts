import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import pino from 'pino';
import * as dotenv from 'dotenv';

dotenv.config();

// Setup logger
export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

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
