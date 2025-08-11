

## DEV

```sh
# say hello
pnpx tsx ./cli/src/cli.ts say-hello

# batch transfer sol
pnpx tsx ./cli/src/cli.ts solana-transfer --rpc $RPC_HTTPS --keypair ./accounts/sender.json --receivers ./data/receivers.csv --batch 1


pnpx tsx ./cli/src/cli.ts solana-transfer --rpc https://devnet.helius-rpc.com/?api-key=afe5087b-10ea-4af5-b0bb-866dfe19a77d --keypair /Users/kx/.config/solana/id.json --receivers ./data/receivers-1.csv --batch-size 1

pnpx tsx ./cli/src/cli.ts solana-transfer --keypair /Users/kx/.config/solana/id.json --receivers ./data/receivers-1.csv --batch-size 1

```

## Building and Installation

### Local Development

To run the CLI during development:

```bash
pnpm run dev say-hello
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
pnpm i -g .

# Now you can run commands directly
ff say-hello
ff solana-transfer --keypair /path/to/keypair.json --receivers ./data/receivers.csv --batch-size 1
```
