import fs from 'fs';

// load private key of mint wallet
// wallet file format:  address,base58,array

export interface WalletInfo {
  address: string;
  base58Key: string;
  arrayKey?: string;
}

export function fetchBs58Key(walletRecord: string): string {
  // 查找第一个和第二个逗号的位置
  const firstCommaIndex = walletRecord.indexOf(',');
  const secondCommaIndex = walletRecord.indexOf(',', firstCommaIndex + 1);
  
  if (firstCommaIndex === -1 || secondCommaIndex === -1) {
    throw new Error('Invalid wallet record format: expected format with at least two commas');
  }
  
  // 提取第一个逗号和第二个逗号之间的内容作为base58格式私钥
  const bs58Key = walletRecord.substring(firstCommaIndex + 1, secondCommaIndex).trim();
  
  if (!bs58Key) {
    throw new Error('Base58 key is empty in the wallet record');
  }
  
  return bs58Key;
}

export function fetchAddress(walletRecord: string): string {
  // 查找第一个逗号的位置
  const firstCommaIndex = walletRecord.indexOf(',');
  
  if (firstCommaIndex === -1) {
    throw new Error('Invalid wallet record format: expected format with at least one comma');
  }
  
  // 提取第一个逗号之前的内容作为地址
  const address = walletRecord.substring(0, firstCommaIndex).trim();
  
  if (!address) {
    throw new Error('Address is empty in the wallet record');
  }
  
  return address;
}

export function parseWalletRecord(walletRecord: string): WalletInfo {
  const address = fetchAddress(walletRecord);
  const base58Key = fetchBs58Key(walletRecord);
  
  // 可选：提取数组格式的私钥
  const secondCommaIndex = walletRecord.indexOf(',', walletRecord.indexOf(',') + 1);
  let arrayKey: string | undefined;
  
  if (secondCommaIndex !== -1) {
    const thirdCommaIndex = walletRecord.indexOf(',', secondCommaIndex + 1);
    if (thirdCommaIndex !== -1) {
      arrayKey = walletRecord.substring(secondCommaIndex + 1, thirdCommaIndex).trim();
    } else {
      arrayKey = walletRecord.substring(secondCommaIndex + 1).trim();
    }
    if (arrayKey === '') {
      arrayKey = undefined;
    }
  }
  
  return {
    address,
    base58Key,
    arrayKey
  };
}

export function readWalletsFromCSV(filePath: string): WalletInfo[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    const wallets: WalletInfo[] = [];
    
    // 跳过可能的标题行（如果第一行包含 "address" 等标题）
    let startIndex = 0;
    if (lines.length > 0 && lines[0].toLowerCase().includes('address')) {
      startIndex = 1;
    }
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue;
      
      try {
        const walletInfo = parseWalletRecord(line);
        wallets.push(walletInfo);
      } catch (error) {
        console.warn(`Warning: Failed to parse line ${i + 1}: ${error}`);
        // 继续处理下一行而不是完全失败
      }
    }
    
    return wallets;
  } catch (error) {
    throw new Error(`Failed to read wallet CSV file: ${error}`);
  }
}

export function readAddressesFromCSV(filePath: string): string[] {
  const wallets = readWalletsFromCSV(filePath);
  return wallets.map(wallet => wallet.address);
}




