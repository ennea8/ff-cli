

## DEV

```sh
# say hello
pnpx tsx ./cli/src/cli.ts say-hello

# batch transfer sol
pnpx tsx ./cli/src/cli.ts solana-transfer --rpc $RPC_HTTPS --keypair ./accounts/sender.json --receivers ./data/receivers.csv --batch 1

```
