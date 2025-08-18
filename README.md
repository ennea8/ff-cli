# FF CLI Tool

A command-line interface (CLI) tool for batch operations on the Solana blockchain.

## Features

- Batch transfer SOL to multiple recipients
- Batch transfer SPL tokens to multiple recipients
- Resumable transfers with progress tracking
- Configurable batch sizes

## Usage

## Installation

```bash
pnpm install -g ff-cli
 or 
npm install -g ff-cli

```

```bash
ff --version
```


### Development

To run commands during development:

```bash

# Transfer SOL to multiple recipients
pnpm run dev solana-transfer --keypair /path/to/keypair.json --receivers ./data/receivers.csv --batch-size 1

# Transfer SPL tokens to multiple recipients
pnpm run dev token-transfer --keypair /path/to/keypair.json --receivers ./data/receivers.csv --mint TOKEN_MINT_ADDRESS --batch-size 1
```

### Command Options

#### SOL Transfer

```bash
ff solana-transfer \
  --keypair /path/to/keypair.json \
  --receivers ./data/receivers.csv \
  --batch-size 5 \
  --rpc https://api.mainnet-beta.solana.com  # Optional, defaults to SOLANA_RPC_URL env variable
```

#### SPL Token Transfer

```bash
ff token-transfer \
  --keypair /path/to/keypair.json \
  --receivers ./data/receivers.csv \
  --mint TOKEN_MINT_ADDRESS \
  --batch-size 5 \
  --rpc https://api.mainnet-beta.solana.com  # Optional, defaults to SOLANA_RPC_URL env variable
```

### CSV Format

The receivers CSV file should contain the following columns:

```
address,amount
FIRST_ADDRESS,0.01
SECOND_ADDRESS,0.02
THIRD_ADDRESS,0.03
```

- For SOL transfers, the amount is in SOL units
- For token transfers, the amount is in token units

## Building and Installation

### Local Development

To run the CLI during development:

```bash
pnpm run dev solana-transfer --keypair /path/to/keypair.json --receivers ./data/receivers.csv --batch-size 1
```

### Building the CLI

To build the CLI for distribution:

```bash
pnpm run build
```

This will compile the TypeScript code to JavaScript in the `dist` directory.

### Global Installation

To install the CLI globally on your system:

```bash
# From the project directory
pnpm install-global

# Now you can run commands directly
ff solana-transfer --keypair /path/to/keypair.json --receivers ./data/receivers.csv --batch-size 1
```
