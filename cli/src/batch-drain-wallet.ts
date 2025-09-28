import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { logger } from './utils';
import { executeDrainWallet } from './drain-wallet';
import { readWalletsFromCSV, WalletInfo } from './utils.wallet';
import { createObjectCsvWriter } from 'csv-writer';
import bs58 from 'bs58';

/**
 * Parse destination addresses from CSV file
 */
const parseDestinationAddresses = (filePath: string): string[] => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    const addresses: string[] = [];
    
    // 检查是否是CSV格式还是纯地址列表
    if (lines[0].includes(',')) {
      // CSV格式，解析第一列作为地址
      const records = parse(content, {
        skip_empty_lines: true,
        trim: true,
      });
      
      records.forEach((record: any, index: number) => {
        // 尝试从第一列获取地址
        const address = record[0]?.trim();
        
        if (!address) {
          logger.warn(`Missing destination address in row ${index + 1}, skipping...`);
          return;
        }
        
        addresses.push(address);
      });
    } else {
      // 纯地址列表，每行一个地址
      lines.forEach((line, index) => {
        const address = line.trim();
        if (address) {
          addresses.push(address);
        }
      });
    }
    
    return addresses;
  } catch (error) {
    logger.error(`Failed to parse destination addresses: ${error}`);
    throw error;
  }
};

/**
 * Execute batch drain wallet operations
 */
export const executeBatchDrainWallet = async (
  rpcUrl: string | undefined,
  sourceWalletsPath: string,
  destinationAddressesPath: string,
  options: {
    dryRun?: boolean;
    closeAccounts?: boolean;
    reclaimRent?: boolean;
    keepSol?: number;
    tokens?: string[];
    excludeTokens?: string[];
    minBalance?: number;
    indices?: number[];  // 新增: 要处理的特定索引数组
  } = {}
): Promise<void> => {
  try {
    // 1. 读取源钱包信息（带私钥）
    logger.info(`Reading source wallets from ${sourceWalletsPath}...`);
    const sourceWallets = readWalletsFromCSV(sourceWalletsPath);
    logger.info(`Loaded ${sourceWallets.length} source wallets`);
    
    // 2. 读取目标钱包地址
    logger.info(`Reading destination addresses from ${destinationAddressesPath}...`);
    const destinationAddresses = parseDestinationAddresses(destinationAddressesPath);
    logger.info(`Loaded ${destinationAddresses.length} destination addresses`);
    
    // 3. 验证源钱包和目标钱包数量是否匹配
    if (sourceWallets.length !== destinationAddresses.length) {
      logger.warn(`Warning: Number of source wallets (${sourceWallets.length}) doesn't match number of destination addresses (${destinationAddresses.length})`);
      logger.warn('Proceeding with the minimum number of pairs');
    }
    
    // 使用两个列表中较小的长度作为操作数
    const operationCount = Math.min(sourceWallets.length, destinationAddresses.length);
    
    // 如果指定了索引，则只处理这些索引
    const indicesToProcess: number[] = options.indices || [];
    
    if (indicesToProcess.length > 0) {
      logger.info(`Specific indices provided: ${indicesToProcess.join(', ')}. Only processing these indices.`);
      // 验证索引是否合法
      const invalidIndices = indicesToProcess.filter(idx => idx < 0 || idx >= operationCount);
      if (invalidIndices.length > 0) {
        logger.warn(`Warning: Some provided indices are out of range and will be skipped: ${invalidIndices.join(', ')}`);
      }
    }
    
    let successCount = 0;
    let failCount = 0;
    
    logger.info('='.repeat(50));
    logger.info('BATCH WALLET DRAIN OPERATION STARTED');
    // 收集失败的操作
    const failedOperations = [];
    
    // 创建失败操作的记录结构
    interface FailedOperation {
      index: number;          // 文件中的索引
      fromAddress: string;
      toAddress: string;
      reason: string;
      timestamp: string;
    }
    
    const failedOps: FailedOperation[] = [];
    
    for (let i = 0; i < operationCount; i++) {
      // 如果指定了索引列表，则只处理这些索引
      if (indicesToProcess.length > 0 && !indicesToProcess.includes(i)) {
        logger.info(`Skipping index ${i} as it's not in the specified indices list`);
        continue;
      }
      
      const sourceWallet = sourceWallets[i];
      const destinationAddress = destinationAddresses[i];
      
      logger.info(`\nProcessing operation ${i+1}/${operationCount} (index: ${i}): ${sourceWallet.address} -> ${destinationAddress}`);
      
      if (!sourceWallet.base58Key) {
        const failureReason = 'No private key available';
        logger.error(`No private key available for wallet ${sourceWallet.address}, skipping...`);
        
        // 记录失败的操作
        failedOps.push({
          index: i,  // 使用索引替代私钥
          fromAddress: sourceWallet.address,
          toAddress: destinationAddress,
          reason: failureReason,
          timestamp: new Date().toISOString(),
        });
        
        failCount++;
        continue;
      }
      
      try {
        // 执行单个drain-wallet操作
        logger.info(`Draining wallet ${sourceWallet.address} to ${destinationAddress}...`);
        
        // For batch operations, we recommend slightly higher keepSol for safety if none was specified
        const adjustedOptions = { ...options };
        if (!options.keepSol && options.keepSol !== 0) {
          adjustedOptions.keepSol = 0.001; // Default keep 0.001 SOL for safety in batch operations
          logger.info(`No keepSol specified, using default of ${adjustedOptions.keepSol} SOL for batch operations`);
        } else if (options.keepSol < 0.001 && !options.dryRun) {
          logger.warn(`Low keepSol value (${options.keepSol} SOL) may lead to failures due to transaction fees and rent requirements`);
        }
        
        await executeDrainWallet(
          rpcUrl,
          undefined, // sourceKeypairPath
          sourceWallet.base58Key, // sourceKeyBs58
          destinationAddress,
          adjustedOptions
        );
        
        logger.info(`Successfully drained wallet ${sourceWallet.address}`);
        successCount++;
      } catch (error) {
        const errorMsg = `${error}`.toLowerCase();
        let failureReason = '';
        
        if (errorMsg.includes('insufficient funds') || errorMsg.includes('rent')) {
          failureReason = 'Insufficient SOL for transaction fees or rent';
          logger.error(`Failed to drain wallet ${sourceWallet.address}: ${failureReason}. Try using --keep-sol 0.002 or higher.`);
        } else {
          failureReason = `${error}`;
          logger.error(`Failed to drain wallet ${sourceWallet.address}: ${error}`);
        }
        
        // 记录失败的操作
        failedOps.push({
          index: i,  // 使用索引替代私钥
          fromAddress: sourceWallet.address,
          toAddress: destinationAddress,
          reason: failureReason,
          timestamp: new Date().toISOString(),
        });
        
        failCount++;
      }
    }
    
    // 打印摘要
    logger.info('\n' + '='.repeat(50));
    logger.info('BATCH OPERATION SUMMARY');
    logger.info('='.repeat(50));
    logger.info(`Total operations: ${operationCount}`);
    logger.info(`Successful: ${successCount}`);
    logger.info(`Failed: ${failCount}`);
    logger.info('='.repeat(50));
    
    // 如果存在失败的操作，将它们记录到一个单独的CSV文件中
    if (failedOps.length > 0) {
      // 创建输出目录如果不存在
      const outDir = path.join(process.cwd(), 'out');
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      
      // 生成时间戳文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const failedOpsFilePath = path.join(outDir, `failed_drains_${timestamp}.csv`);
      
      // 写入CSV文件
      const csvWriter = createObjectCsvWriter({
        path: failedOpsFilePath,
        header: [
          { id: 'index', title: 'index' },
          { id: 'fromAddress', title: 'from_address' },
          { id: 'toAddress', title: 'to_address' },
          { id: 'reason', title: 'failure_reason' },
          { id: 'timestamp', title: 'timestamp' },
        ],
      });
      
      await csvWriter.writeRecords(failedOps);
      logger.info(`Failed address pairs saved to: ${failedOpsFilePath}`);
    }
    
    // 如果有操作失败，但总体成功了一部分，返回信息
    if (failCount > 0 && successCount > 0) {
      logger.info(`Partial success: ${successCount} out of ${operationCount} operations completed successfully.`);
    } else if (successCount === operationCount) {
      logger.info(`All ${operationCount} drain operations completed successfully!`);
    } else {
      logger.error(`All ${operationCount} drain operations failed!`);
    }
    
  } catch (error) {
    logger.error(`Batch drain wallet operation failed: ${error}`);
    throw error;
  }
};
