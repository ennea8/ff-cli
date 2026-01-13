import fs from 'fs';
import path from 'path';
import { logger } from './utils';
import {
  arrayToBase58,
  base58ToArray,
  getPublicKey,
  readKeyFromFile,
} from './key-utils';

interface WalletFormatOptions {
  keyBs58?: string;
  keyArray?: string;
  keyFile?: string;
  outputDir?: string;
  stdoutOnly?: boolean;
  overwrite?: boolean;
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'out');

const normalizeArrayString = (value: string): string => {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    throw new Error('Array key must be in [1,2,...] format');
  }
  return trimmed;
};

const detectKeyType = (content: string): 'array' | 'base58' => {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Key content is empty');
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return 'array';
  }
  return 'base58';
};

export async function executeWalletFormat(options: WalletFormatOptions): Promise<void> {
  try {
    const { keyBs58, keyArray, keyFile, outputDir, stdoutOnly, overwrite } = options;

    const providedSources = [keyBs58, keyArray, keyFile].filter(Boolean).length;
    if (providedSources !== 1) {
      throw new Error('Please provide exactly one of --key-bs58, --key-array, or --key-file');
    }

    let base58Key: string;
    let arrayKey: string;

    if (keyBs58) {
      base58Key = keyBs58.trim();
      if (!base58Key) {
        throw new Error('Provided base58 key is empty');
      }
      arrayKey = base58ToArray(base58Key);
    } else if (keyArray) {
      arrayKey = normalizeArrayString(keyArray);
      base58Key = arrayToBase58(arrayKey);
    } else {
      const fileContent = readKeyFromFile(keyFile!);
      const type = detectKeyType(fileContent);
      if (type === 'array') {
        arrayKey = normalizeArrayString(fileContent);
        base58Key = arrayToBase58(arrayKey);
      } else {
        base58Key = fileContent.trim();
        if (!base58Key) {
          throw new Error('Provided base58 key is empty');
        }
        arrayKey = base58ToArray(base58Key);
      }
    }

    const address = getPublicKey(base58Key);
    const csvRow = `${address},${base58Key},${arrayKey}`;

    if (!stdoutOnly) {
      const finalOutputDir = outputDir ? path.resolve(outputDir) : DEFAULT_OUTPUT_DIR;
      if (!fs.existsSync(finalOutputDir)) {
        fs.mkdirSync(finalOutputDir, { recursive: true });
      }

      const filePath = path.join(finalOutputDir, `${address}.csv`);
      if (fs.existsSync(filePath) && !overwrite) {
        throw new Error(`File ${filePath} already exists. Use --overwrite to replace it.`);
      }

      fs.writeFileSync(filePath, `${csvRow}\n`, 'utf8');
      logger.info(`Wallet CSV saved to ${filePath}`);
    }

    console.log(csvRow);
  } catch (error) {
    console.error(`wallet-format error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
