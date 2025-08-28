# FF CLI - Solana Batch Operations Tool

A powerful command-line interface for performing batch operations on the Solana blockchain, including SOL and SPL token transfers, and balance queries.

## Features

- **One-to-Many Transfers**: Send SOL or tokens from one wallet to multiple recipients
- **Many-to-Many Transfers**: Execute multiple transfers using different source wallets
- **Balance Queries**: Check SOL and token balances for multiple wallets
- **File Encryption/Decryption**: Password-protected file encryption and decryption
- **Token Support**: Full support for both SPL Token and Token-2022 standards
- **Atomic Operations**: Account creation and transfers in single transactions
- **Progress Tracking**: Resumable operations with automatic progress saving
- **Comprehensive Logging**: Detailed logs and CSV output for all operations

## Installation

### Global Installation
```bash
npm install -g ff-cli
# or
pnpm install -g ff-cli
```

### Development Setup
```bash
git clone <repository-url>
cd ff-cli

# for pnpm
pnpm install
pnpm run build
pnpm link .
pnpm link --global

# for npm
npm install
npm run build
npm link
```


## Commands Overview

| Command | Description | Use Case |
|---------|-------------|----------|
| `transfer-one2many` | Transfer from one wallet to multiple recipients | Airdrops, payouts |
| `transfer-many2many` | Transfer from multiple wallets using private keys | Complex multi-wallet operations |
| `balance-query` | Query balances for multiple wallets | Portfolio tracking, auditing |
| `encrypt` | Encrypt a file with password protection | Securing sensitive data |
| `decrypt` | Decrypt a previously encrypted file | Accessing secured data |

## Command Reference

### encrypt

Encrypt a file with password protection.

```bash
ff encrypt --input <path> [--output <path>] [--password <string>]
```

**Options:**
- `--input <path>`: Path to input file to encrypt
- `--output <path>`: Path to output encrypted file (defaults to input path + .encrypted)
- `--password <string>`: Password for encryption (if not provided, will prompt)

**Examples:**
```bash
# Encrypt a file (will prompt for password)
ff encrypt --input sensitive_data.json

# Encrypt with password provided directly
ff encrypt --input sensitive_data.json --password mySecurePassword123 --output encrypted_data
```

**Security Features:**
- Secure password masking in terminal
- File overwrite confirmation to prevent accidental data loss
- Strong AES-256-GCM encryption with authentication
- PBKDF2 key derivation with 100,000 iterations

### decrypt

Decrypt a previously encrypted file.

```bash
ff decrypt --input <path> [--output <path>] [--password <string>]
```

**Options:**
- `--input <path>`: Path to encrypted input file
- `--output <path>`: Path to output decrypted file (defaults to input path without .encrypted extension)
- `--password <string>`: Password for decryption (if not provided, will prompt)

**Examples:**
```bash
# Decrypt a file (will prompt for password)
ff decrypt --input sensitive_data.json.encrypted

# Decrypt with password provided directly
ff decrypt --input sensitive_data.json.encrypted --password mySecurePassword123 --output decrypted_data.json
```

**Security Features:**
- Secure password masking in terminal
- File overwrite confirmation to prevent accidental data loss
- Automatic detection and handling of encrypted file format

### transfer-one2many

Transfer SOL or tokens from one address to multiple recipients.

```bash
ff transfer-one2many --keypair <path> --receivers <path> [--mint <address>] [options]
```

**Options:**
- `--keypair <path>`: Path to sender keypair JSON file
- `--receivers <path>`: Path to CSV file with recipient data
- `--mint <address>`: Token mint address (optional, defaults to SOL)
- `--rpc <url>`: Solana RPC endpoint (optional)
- `--batch-size <number>`: Transfers per batch (default: 1)

**Examples:**
```bash
# Transfer SOL to multiple recipients
ff transfer-one2many --keypair sender.json --receivers recipients.csv

# Transfer tokens to multiple recipients
ff transfer-one2many --keypair sender.json --receivers recipients.csv --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

### transfer-many2many

Execute many-to-many transfers using wallet private keys and transfer instructions.

```bash
ff transfer-many2many --wallets <path> --transfers <path> [--mint <address>] [options]
```

**Options:**
- `--wallets <path>`: Path to CSV file with wallet addresses and private keys
- `--transfers <path>`: Path to CSV file with transfer instructions
- `--mint <address>`: Token mint address (optional, defaults to SOL)
- `--rpc <url>`: Solana RPC endpoint (optional)

**Examples:**
```bash
# Multiple SOL transfers
ff transfer-many2many --wallets wallets.csv --transfers transfers.csv

# Multiple token transfers
ff transfer-many2many --wallets wallets.csv --transfers transfers.csv --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

### balance-query

Query SOL and token balances for multiple wallet addresses.

```bash
ff balance-query --wallets <path> [--mint <address>] [options]
```

**Options:**
- `--wallets <path>`: Path to CSV file with wallet addresses
- `--mint <address>`: Token mint address (optional, queries SOL if not provided)
- `--rpc <url>`: Solana RPC endpoint (optional)

**Examples:**
```bash
# Query SOL balances
ff balance-query --wallets wallets.csv

# Query token balances
ff balance-query --wallets wallets.csv --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

## CSV File Formats

### Recipients File (for transfer-one2many)
```csv
address,amount
9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM,0.1
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,0.2
FkkAAddSihN8t6uCorntzpMtBeLjWxiHbHKV5sWDPcEU,0.15
```

### Wallets File (for transfer-many2many and balance-query)
```csv
address,base58,array
9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM,5Kj8...base58key...,["array","format"]
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,3Mf9...base58key...,["array","format"]
```

### Transfers File (for transfer-many2many)
```csv
from,to,amount
9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM,FkkAAddSihN8t6uCorntzpMtBeLjWxiHbHKV5sWDPcEU,0.1
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,3R5VpUQ63qzceZ4HLgsNLtYN6mrVWoy6S3T9EycCdr3y,0.2
```

## Configuration

### Environment Variables

Create a `.env` file in your project directory:

```env
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_KEYPAIR_PATH=/path/to/your/keypair.json
```

### RPC Endpoints

Common Solana RPC endpoints:
- **Mainnet**: `https://api.mainnet-beta.solana.com`
- **Devnet**: `https://api.devnet.solana.com`
- **Testnet**: `https://api.testnet.solana.com`

## Output and Logging

### Console Output
All commands provide real-time progress updates and summary tables showing:
- Transfer status (success/failed)
- Transaction signatures
- Error messages
- Summary statistics

### CSV Output
Results are automatically saved to the `out/` directory with timestamped filenames:
- `recipients_balances_2025-01-18.csv`
- `transfers_batch_transfer_2025-01-18.csv`
- `transfers_batch_transfer_2025-01-18_token.csv`

### Log Files
Detailed logs are saved to the `logs/` directory with operation-specific information.

## Progress Tracking

All batch operations support automatic progress tracking:
- Operations can be safely interrupted and resumed
- Progress files are saved with `_progress.json` suffix
- Failed transfers are retried on subsequent runs
- Completed transfers are skipped automatically

## Token Support

### SPL Token
Standard SPL tokens are fully supported with automatic:
- Token account creation
- Decimal handling
- Associated token account management

### Token-2022
Next-generation Token-2022 standard is automatically detected and supported:
- Automatic program detection
- Enhanced metadata support
- Advanced token features

## Error Handling

The CLI includes robust error handling:
- **Network Issues**: Automatic retries with exponential backoff
- **Invalid Addresses**: Skipped with detailed warnings
- **Insufficient Funds**: Clear error messages with balance information
- **Account Creation**: Automatic handling for non-existent token accounts

## Development

### Running in Development
```bash
# Build the project
pnpm run build

# Run commands in development
pnpm run dev transfer-one2many --keypair sender.json --receivers recipients.csv

# Or use tsx directly
pnpx tsx cli/src/cli.ts transfer-one2many --keypair sender.json --receivers recipients.csv
```

### Testing
```bash
# Run tests
pnpm test

# Build for production
pnpm run build
```

## Security Considerations

- **Private Keys**: Store keypair files securely and never commit them to version control
- **RPC Endpoints**: Use trusted RPC providers for production operations
- **Validation**: All addresses and amounts are validated before processing
- **Atomic Operations**: Account creation and transfers are performed atomically

## Troubleshooting

### Common Issues

**"Insufficient funds" error:**
- Check wallet balance with `balance-query` command
- Ensure enough SOL for transaction fees

**"Invalid address" warnings:**
- Verify wallet addresses are valid Solana addresses
- Check for typos in CSV files

**Network timeouts:**
- Try a different RPC endpoint
- Reduce batch size for better reliability

**Token account errors:**
- Token accounts are created automatically
- Ensure sufficient SOL for account creation fees

## License

ISC
